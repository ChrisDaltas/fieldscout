# PROGRESS — Lists v2

> **The build loop's only memory for this build.** Re-read at the start of
> every cycle; never rely on chat history. Every cycle ends at a task boundary
> with this file current and `main` clean, so a session can be compacted or
> killed at any point and a fresh one resumes losslessly.
>
> **Authority:** design LAW (`docs/design/lists/README.md`) > delivery plan
> (`docs/specs/delivery-plan-lists-v2.md` v3.4) > this file.
>
> Active per `docs/specs/ACTIVE-BUILD.md`. Task ids are `LV.*`. **`L.*` tasks
> belong to the paused leagues build — never pick one from here.**

---

## 1. Milestone status

| Round | Contents | Exit criteria | Status |
| --- | --- | --- | --- |
| **Round 1** | Lists page (rail + cards) and list detail (hero, tabs, toolbar, three view styles, drag-and-drop, stats picker, notes, drafted) in the new design language | Both screens match the handoff at desktop and mobile; `featureFlags.listsV2` flipped on; old components retired | 🔵 In progress (LV.1.1, LV.1.2, LV.1.4 landed 2026-08-09) |
| **Round 2** | Side-by-side compare; pop-out windows (app-shell hosted) | — | ⚪ Deferred (plan §6) |

**One task is parked; everything else is clear.** **LV.1.3** cannot land as
written and awaits a ruling — see **§3 Q1**; only LV.3.9 sits downstream of it.
**LV.1.5 is unparked** — Q2 was ruled on 2026-08-09 (widen the CHECK; see §3
Q2), so it is now the next pickable Phase 1 task. Phase 2 (LV.2.1–2.3) and
LV.3.1 need no ruling at all.

Everything in **Phase 2** (LV.2.1–2.3) and **LV.3.1** is unblocked. Downstream
of the one parked task: **LV.3.9** (Q1). LV.3.6 is no longer blocked — Q2's
ruling gives it the full bucket vocabulary once LV.1.5 lands.

---

## 2. Round 1 task checklist

Task text: **delivery plan §4**, read with the handoff section each task cites.
Dependencies in parentheses; pick the first unchecked task whose dependencies
are all checked.

**Phase 1 — foundations**

- [x] **LV.1.1** — `featureFlags.listsV2` + route-level branch so old and new Lists coexist (2026-08-09)
- [x] **LV.1.2** — migration: `list_player_drafted (user_id, list_id, player_id)` + RLS + indexes, and its read/toggle route (D2) (2026-08-09)
- [ ] **LV.1.3** — point `use-draft-mode.ts` **only** at the new server source (LV.1.2) — ⛔ **parked, see §3 Q1**
- [x] **LV.1.4** — session-only display state: `view`, `cols`, band labels, `budget`; **no `persist` middleware** (D3) (2026-08-09)
- [ ] **LV.1.5** — ✅ **Q2 RULED (widen the CHECK)** — one migration + widen the tier route's Zod enum for round/band buckets beyond six; S–F stays valid (D4). **Reconcile the bucket vocabulary with `DEFAULT_COST_BANDS` in `src/stores/list-display-store.ts`** — LV.1.4 chose `c1`–`c4` for cost bands as *session-local* keys that are explicitly **not on the wire**; this task owns what the route actually accepts, so either adopt them or decide the wire keys differ and say so. Widening the enum also turns bucket keys into DB-sourced free text, which is why `resolveBandLabel` is `hasOwnProperty`-guarded (R181/R183). **Includes one migration** — `list_players.tier` carries a live CHECK constraint (`list_players_tier_check`, `003_lists.sql:42-43`) pinning it to NULL or S–F on local **and** hosted production, so widening Zod alone would make every round write a Postgres `23514` returned as an HTTP 500. Vocabulary approved in §3 Q2

**Phase 2 — Lists page**

- [ ] **LV.2.1** — page header: heading, view-mode segmented control, My lists / Saved tabs, New list (LV.1.1)
- [ ] **LV.2.2** — rail mode: 200px sticky rail, shared edge, selected-row treatment (LV.2.1)
- [ ] **LV.2.3** — cards mode: responsive gallery, flat at rest, lift on hover (LV.2.1)

**Phase 3 — list detail**

- [ ] **LV.3.1** — hero: cover, inline rename, byline, action cluster, options menu (LV.1.1)
- [ ] **LV.3.2** — tabs + toolbar: grouping dropdown, view-style toggle, Stats, Add players (LV.3.1, LV.1.4). ⚠️ **The dropdown's non-tier options depend on §3 Q2** — until Q2 is ruled, only `tier` (and plain `rank`) can be written to the server at all. Build the control so the option set is data-driven, and do not ship Round/Cost/Budget entries that would 500 on first use
- [ ] **LV.3.3** — view style List: 60px rows, stat cells, computed `minWidth` (LV.3.2). ⚠️ **Read the `budget` note below before rendering anything budget-shaped** (R185)
- [ ] **LV.3.4** — view style Table: 44px rows, sticky header (LV.3.2)
- [ ] **LV.3.5** — view style Cards: corner cells, stat strip, label rail (LV.3.2). ⚠️ **Same `budget` note** (R185)
- [ ] **LV.3.6** — drag-and-drop across all three views; header drop assigns the bucket (LV.3.3–3.5, LV.1.5). ⛔ **Blocked by §3 Q2 for every mode except tier** — the drop *is* the tier write (D4), so a drop onto a Round header is a `23514` today
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

**Forward note — `budget` is held but nothing can render it (R185, filed
2026-08-09 by the LV.1.4 Reviewer).** LV.1.4 stores `budget` faithfully because
**D3** names it. But **D4** and plan §2.2 delete per-player `cost` outright, and
share-of-budget from a player's `cost` is the *only* thing the prototype ever
computes from `budget` (`docs/design/lists/design/ListsBody.jsx:109`,
`lists.js:440-455`). So under our own decisions the number has no consumer.
Related: the prototype's budget bands (`b1`–`b4`, `lists.js:442-445`) are
threshold-derived and have **no defaults** on our side, so
`resolveBandLabel('b1', {})` renders the raw key `b1`.

This is a **plan-level tension, not a Builder error** — nobody is to "fix" it by
reintroducing a `cost` field, which D4 rejects. LV.3.3 and LV.3.5 are where it
surfaces. Whoever gets there first: if budget grouping is meant to ship, it needs
a product answer (default band labels, and what the number means with nothing to
divide by) — **file it in §3 and HALT**, do not invent one. If it is not meant to
ship in Round 1, say so in the plan and drop `budget` from the toolbar.

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

**Status: awaiting Chris's ruling.** LV.1.3 is parked; the loop continues on other
unblocked Phase 1 tasks.

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

- **LV.1.5 (2026-08-09) — the bucket vocabulary is designed but NOT decided.**
  The LV.1.5 task text directs the wire vocabulary to be recorded here, since
  LV.3.2, LV.3.5 and LV.3.6 all inherit it. It is **not** recorded here, because
  it was not ruled: the task halted before implementation on **§3 Q2**
  (`list_players.tier` carries a live CHECK constraint pinning it to S–F, so the
  widening needs a migration this build forbids). The full proposal — the key
  sets, the `c1`–`c4` reconciliation with `DEFAULT_COST_BANDS`, why budget mints
  no keys, the round ceiling and its justification, and what the closed shape
  rules out — lives in **§3 Q2** and moves here, unchanged or amended, when
  Chris rules. **Do not treat the Q2 proposal as decided.**

---

## 5. Blockers

- **LV.1.3 is parked pending Chris's ruling on §3 Q1** (filed 2026-08-09) — its
  task text rewires a hook whose only two consumers are production-legacy and
  off-limits. Nothing else in Round 1 is blocked by it except **LV.3.9**, which
  depends on it. Do not pick LV.1.3 until Q1 is answered.

- **LV.1.5 — RESOLVED 2026-08-09, no longer a blocker.** Q2 was ruled: widen
  the CHECK. The finding stands as recorded — `list_players_tier_check`
  (`003_lists.sql:42-43`) is live locally **and** on hosted production, so
  widening the Zod enum alone would convert a clean 400 into a Postgres `23514`
  surfaced as an HTTP 500. The fix is one `ALTER TABLE`, now the build's second
  and final sanctioned schema change (plan §1, D4, D6 — v3.5). LV.3.6 unblocks
  with it.

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
  crash**: 002, 013, 014, 015, 016, 018, 020, 022, 026; the other 20 pass.
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
  `create_league` at team_count 14, draft-core picks, settings PATCH 409).
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
| **R176** — `drafted-service.ts` `listDrafted` (GET) still collapses "you hold no marks" with "you asked on behalf of someone you cannot speak for" into `200 {drafted: []}` — the exact shape R175's contract forbids eleven lines above. Reachability is identical to the un-mark path that got a hard 403, so the asymmetry now lives inside one file | nit | **Open.** Fix direction: call `assertCallerIs` when the read returns empty, or add a header line stating the read path is deliberately unguarded and why. Fold into **LV.1.3**, which consumes `listDrafted` |
| **R177** — two imprecisions in the newly-amended honesty text: 028's break map says the 013 substitution fails "the 067 pin and nothing else" when it measurably fails **two** (38 + the total-rows epilogue 47), disagreeing with PROGRESS §6 which records both; and 079's banner cites `drafted-service.test.ts` as corroborating green when that suite drives a `noDatabase` Proxy and **structurally cannot** redden for an RLS change | nit | **Open.** Fix direction: "assertion 38, plus the downstream epilogue count"; cite the stack suite alone as the DB-reaching green |
| **R178** — the lazy guard adds an `auth.getUser()` round-trip on the legitimate idempotent-replay path, which this file's own header says to expect (optimistic checkbox retries); the route proved the same identity one call earlier | nit | **Open, no action at LV.1.2 scope.** If LV.1.3 shows retry volume, thread the route's already-verified user into the service instead of re-fetching |

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
