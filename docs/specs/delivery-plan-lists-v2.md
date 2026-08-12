# Delivery Plan: Lists v2

> **v6.1 — 2026-08-12. UI/UX only, with exactly three data exceptions.**
> *(v6.0 was the bump for Chris's two LV.17 rulings; v6.1 adds his third — the
> sheet rests on the bottom tab bar and a tap outside dismisses it — and
> corrects one claim v6.0 made that was false, **R257**.)*
>
> **Round 1 is complete.** LV.7 landed the cutover on 2026-08-11: one Lists
> surface, no `featureFlags.listsV2`, the legacy tree deleted — and four
> capabilities *ported* rather than lost, per Chris's §3 Q3 ruling (**D11**).
>
> **Round 2 is active** — side-by-side compare and pop-out windows, §6, tasks
> **LV.12 – LV.17**. It adds **no** schema (D12) and its one behavioural fork
> is ruled in **D12**: the drafted checkbox fans out across the columns you
> picked, never globally.
>
> Everything the handoff needs that has no home in the current schema is
> **client-side state**, **relabelled onto an existing field**, or **dropped
> from scope** — with three deliberate exceptions, each individually ruled by
> Chris: **(1) `drafted` persists server-side** — per user, per list — because
> seeing who is already gone from your phone is the point of the feature
> (2026-08-09); **(2) `list_players.tier`'s CHECK constraint widens**, because
> round grouping cannot represent a 12–16 round draft against six buckets
> (2026-08-09); and **(3) `list_links`**, so a list can link back to the
> resources it drew on and a creator can attach their own video (2026-08-11).
> Between them that is two new tables and one `ALTER TABLE`. Nothing else.
>
> **The budget is now closed at three.** A task that believes it needs a fourth
> has left scope: stop and raise it.
>
> Everything else that only affects how a list *looks* — view style, chosen
> stat columns, band labels, budget — is **deliberately not saved**. Chris:
> *"just customizations that don't need to save, like search filters."*
>
> Ships **ahead of M2 leagues**, on its own track. M2 pauses at L.B3.1.
>
> **Design LAW is `docs/design/lists/README.md`** — the committed Claude Design
> handoff, with prototype source in `docs/design/lists/design/`. This plan
> never overrides it. Where the handoff is silent (loading, empty, error,
> overflow), extend the new design language per CLAUDE.md.
>
> If the handoff seems wrong or ambiguous: **stop**, write the question and a
> recommendation into `PROGRESS-lists-v2.md`. Do not improvise around it.

---

## 1. Rulings in force

| Ruling | Detail |
| --- | --- |
| **UI/UX only, three exceptions** | No schema changes except (a) the `drafted` table (D2/LV.1.2), (b) widening `list_players.tier`'s CHECK constraint (D4/LV.1.5, **ruled by Chris 2026-08-09**), and (c) the `list_links` table (D8/LV.8, **ruled by Chris 2026-08-11**). Nothing else — the budget is **closed at three**. See §2.2. |
| **Display prefs don't persist** | View style, stat columns, band labels, budget are session customizations — like search filters. Not saved, by decision, not by constraint. |
| **Boards are off limits — one amendment** | *"We should not be touching boards at all right now"* (Chris, 2026-08-09). No task opens `src/components/big-board/**` or `src/stores/board-labels-store.ts`. **Amended 2026-08-10:** `src/components/lists/draft-mode/**` is reopened for **deletion of the 3-state cycle only** (`use-board-marks.ts` and its wiring), superseded by the permanent drafted checkbox (D2). Nothing else in that tree is in scope. A list is not a board: **lists persist forever, boards are season-bound.** |
| **Scale** | The app's ×0.8 tokens **stay**. Convert the handoff's 1× numbers down: a stated 32px control is `h-btn-sm` (26); a stated 1.25px border is `border-1`. Re-tokenizing is post-launch. |
| **Color** | Implement from **tokens, never the handoff's literal hex**. The prototype is token-driven (19 × `var(--accent)`, zero hardcoded blues); its `#1F6BF0` describes what that token resolved to in *their* bundle. The app's `accent` is `#3d5cff`. |
| **Flag** | ~~All of it behind `featureFlags.listsV2`. On in local dev, off deployed, until Chris flips it. The current Lists page serves production throughout.~~ **Spent and removed at LV.7 (2026-08-11).** The flag, its `.env.example` block, its test and both route branches are gone; `/app/lists` serves the rebuilt page unconditionally. Do not reintroduce it — a flag with one branch is a lie about what ships. |
| **Free-only** | No `is_pro` gates. |
| **Round 1 scope** | Lists page + list detail. Side-by-side compare and pop-out windows are **Round 2** (§6). *(Ruled by Chris, 2026-08-09.)* |
| **A pop-out of a list that is gone closes, with a toast** | *"Close it, with a toast."* — Chris, 2026-08-12 (PROGRESS §3 **Q5**). Window closes; the toast reads **"This list is no longer available."** The copy is **neutral about cause on purpose**: the 404 behind it is *also* a list that is alive and merely no longer visible to the viewer, so no surface may say "deleted". Reverses LV.17's persist-and-explain. |
| **Pop-outs get a real mobile variant** | *"On a mobile the pop out window is full width but only 60% of the screen height. the tool bar only shows Close and Options. All options go into the option menu."* — Chris, 2026-08-12 (PROGRESS §3 **Q6**). Below **768px** (one breakpoint, `WINDOW_MOBILE_MAX_W`). Overrules LV.17's *"the phone gets the same window"*, which was a Builder decision. **This ruling is about pop-outs only** — D14's *"leave the phone version as is"* still governs Side by side, and neither is inferred onto the other. |
| **The sheet rests on the tab bar, and a tap outside dismisses it** | *"add tap outside to dismiss but also the bottom should be right at the top of the bottom bar"* — Chris, 2026-08-12 (**R258**). Amends the ruling above, which as first built anchored the sheet at the viewport floor and **completely covered the bottom tab bar** — measured at 375 × 812, nav `[0, 748, 375, 64]` under a sheet `[0, 324.8, 375, 487.2]`, so a phone could not navigate at all while a pop-out was open, with the header `Close` the only way out. **The 60% is unchanged and is still of the viewport** — the sheet moved up, it did not shrink into what was left. **Phones only**: a desktop pop-out is not modal and must never close on an outside click. |

---

## 2. Current state (surveyed 2026-08-09, grep-verified)

- **Routes exist and are wired**: `src/app/app/lists/page.tsx` (48 lines),
  `[listId]/page.tsx` (77), plus `new/` and `draft-mode/`. Public share route
  is `src/app/u/[username]/lists/[listSlug]/page.tsx`.
- **The UI weight is in two components**: `list-detail-view.tsx` is **2,161
  lines**; `lists-browse.tsx` 328; `list-card.tsx` 325. Round 1 roughly doubles
  this surface — hence one task per PR, not one big branch.
- **20 API route files** under `src/app/api/lists/` already cover
  `players/reorder`, `players/[playerId]/tier`, `players/[playerId]/slot`,
  `players/bulk`, `duplicate`, `favorite`, `comments`, `like`, `thumbnail`,
  `trash`, `restore`, `generate` (AI). Round 1 adds **one** — the `drafted`
  toggle (LV.1.2).
- **Share-link permanence is already correct and tested.** Renaming a list does
  not regenerate its slug; `share-link-permanence.test.ts` guards it.
  **Do not touch slug generation.**
- **Client-persisted UI state is an established pattern** — Zustand `persist` +
  `createJSONStorage(localStorage)` in **seven** stores: `ai-build-store`,
  `list-order-store`, `history-store`, `rail-store`, `ui-store`,
  `board-labels-store`, `player-windows-store`. *(`ui-store` was missing from
  this list through v3.3 and the miscount was inherited verbatim by LV.1.4's
  store header — Reviewer R184. Verify with
  `grep -ln "persist(" src/stores/*-store.ts` before quoting it again — that
  glob deliberately excludes `list-display-store.test.ts`, whose D3 control
  builds a persisted store on purpose.)* Anything **not** persisted in `src/stores/` is
  therefore a deliberate exception and needs to say so — see D3.
- **Stat columns are a fixed 7-option chip picker** (`customize-popover.tsx`,
  102 lines: proj, current, last, adp, sos, auction, bye) with **no
  persistence at all**. The handoff wants a searchable, grouped, reorderable
  catalog — a rebuild, but one that can only improve on "not saved anywhere".

### 2.1 `drafted` — the handoff is overridden here

The handoff's store rule says `drafted` is **global**: "toggling a player
drafted sets the flag on that player in *every* list that contains him."

**That is rejected** (Chris, 2026-08-09). Drafted is **per user, per list**.
The reason is concrete: *"players will have multiple lists for multiple
leagues"* — a player taken in your Tuesday auction is not taken in Thursday's
redraft, and a global flag would wipe him off boards for drafts that have not
happened. This is the one place Round 1 deviates from the design LAW, and it
is deliberate.

It also means the existing behavior is already correct. Three
implementations exist:

| Implementation | Scope | Storage |
| --- | --- | --- |
| `src/hooks/use-draft-mode.ts` | **per list** — `fieldscout.drafted.${listId}` | localStorage |
| `src/stores/board-labels-store.ts` | **per player, global** — `'drafted' \| 'dnd'` | Zustand + localStorage |
| `src/components/lists/draft-mode/use-board-marks.ts` | per *set* of lists, 3-state cycle | localStorage |

**`use-draft-mode.ts` is already keyed by list** — `fieldscout.drafted.${listId}`
— which is exactly the semantics we want. **Nothing about its behavior
changes; only where it stores.** That is the whole of LV.1.3.

`board-labels-store` (Big Board) stays untouched — global-per-player is
precisely the wrong model here, whatever the handoff says.

`use-board-marks.ts` is **deleted, not preserved** (Chris, 2026-08-10). Its
tap-cycle is superseded by the permanent drafted checkbox, and keeping both
would leave two overlapping mark systems rendering in the same column with
different lifetimes — which is what the old `/app/lists/draft-mode` does
today: it *reads* `use-draft-mode`'s marks for the strikethrough and count,
while its own taps write a separate browser-only 3-state. Chris: *"I think
there is a use case for that functionality but not at this time with our list
feature."* Removal rides with the surface it belongs to (§4, LV.4.4).

### 2.2 Closing the data-model gap

| Handoff need | How it is met | Cost |
| --- | --- | --- |
| `entries[].drafted` | **Server-side** — one new table, **per user per list**, cross-device (D2/LV.1.2). The handoff's global rule is overridden (§2.1) | the one exception |
| `view` (list \| table \| card) | Session state, **not persisted** — a customization, like a search filter | none |
| `cols` (chosen stats, ordered) | Same — session only | none |
| `costBands` labels, `budget` | Same — session only | none |
| `org` = tier \| round \| cost \| budget | **One mechanism** — the bucket is `list_players.tier`; `org` only swaps the label set (D4). Ranked = array order | none |
| `tags` | `list_tags` + `tags` tables already exist | none |
| `fav` / `saved` | `is_favorites` + `list_favorites` already exist | none |
| `stats.views/likes` | `view_count` / `like_count` already exist | none |
| `cover.{color,emoji}` | Use existing `thumbnail_url` only — no color/emoji picker | **reduced** |
| `visibility` | **Private or public only** (Chris, 2026-08-09) — the handoff's third "link" state is not wanted. Existing `is_private` covers it exactly | none |
| `entries[].round` / `.cost` | Not separate fields — they are the same bucket as `tier`, relabelled (D4) | none |
| `scope` | **Dropped** — defined but never rendered | dropped |
| `links[]` | **NOT dropped — corrected 2026-08-10 from the screenshots**, then **built at LV.8** (2026-08-11). `screens/detail-tab-details.png` renders an **Attached links** section (video with title, source, duration, remove control) plus an "Attach a video or article" action. Stored in the new `list_links` table (D8) — reads follow the list, writes are owner-only | the third exception |

**What is deliberate, not a compromise** — stated plainly so nobody
"fixes" it later:

1. **Display preferences do not persist.** View style, chosen stat columns,
   band labels and budget reset like a search filter does. This is a decision
   (Chris, 2026-08-09), not a limitation. The handoff implies a shared list
   opens the way its author arranged it — **it does not, and that is fine.**
   Do not add columns for these.
2. **Visibility is private/public.** The handoff's third "link" state is not
   wanted; `is_private` covers it exactly. Do not build toward it.
3. **Bucket membership does travel** — it lives in `list_players.tier`
   server-side, so which players sit in which tier/round/band follows a shared
   list on any device. Only the *label set* is session state.
4. **`drafted` travels between devices, not between lists** — server-side,
   scoped to one user and one list (D2). It had to leave UI-only for one
   reason: a list that forgets who is gone the moment you pick up your phone
   is useless on draft night. It is still only a display treatment.
5. **Lists are permanent.** They do not expire or roll over by season, and
   `lists` gets no season column, ever. Neither does the drafted table —
   per-list scoping already separates one draft from the next.

---

## 3. Design decisions

- **D1 — Re-skin in place, per CLAUDE.md — with the two Lists screens named
  as the exception.** *(Amended v3.3; see the note below.)*

  **Shared primitives in `src/components/ui/` get CVA variants, never forks.**
  That prohibition is absolute and survives unchanged — it is the whole of
  what "no parallel component tree" means for this build. No task creates a
  second `button.tsx`, `card.tsx`, `dialog.tsx`, or any other `ui/` twin.

  **The Lists v2 screens themselves live in `src/components/lists/v2/`** and
  are swapped in at the **route-level branch** on `featureFlags.listsV2`
  (LV.1.1). Today's components stay untouched beside them, serving production
  for the whole build, and are **retired at LV.4.4**. Do not re-derive this
  per task: §4 already requires it. LV.1.1 mandates a branch at the *route*,
  which necessarily means two component trees per route — a body-replacement
  mechanism would have to branch *inside* `lists-browse.tsx` /
  `list-detail-view.tsx` instead, which is not what LV.1.1 says. And LV.4.4's
  "retire the old components" presupposes the old components surviving as
  separate files right to the end.

  v3.2's wording ("New Lists replaces the bodies of existing components
  behind the flag") contradicted both of those and is withdrawn. This is
  editorial reconciliation of D1 against §4/LV.4.4 and the shipped LV.1.1
  structure (R168) — **no product decision is being made here.**

- **D2 — `drafted` is per user, per list, and purely a display state**
  (Chris, 2026-08-09). It overrides the handoff's global rule — see §2.1.

  Chris: *"marking as drafted should be nothing more than telling the UI to
  display that player differently in that list."* Treat that as the ceiling on
  this feature. It is a strikethrough/dim treatment plus a checkbox. It does
  **not** reorder, filter, cascade to other lists, affect rank, or feed
  anything downstream.

  It persists server-side only so the marks follow you between devices
  mid-draft — that is the entire reason it earns a table:

  ```
  list_player_drafted (user_id, list_id, player_id, drafted_at)
    primary key (user_id, list_id, player_id)
    RLS: every operation requires auth.uid() = user_id
  ```

  **Why `user_id` when a list already has an owner:** so that marking drafted
  on a *saved* list (someone else's, per the handoff's Saved tab) records your
  marks rather than editing their list. A `drafted` column on `list_players`
  would be simpler, but two people using the same shared board on draft night
  would overwrite each other. The extra column is the cheaper bug.

  **No season column.** Per-list scoping already does that work — a 2026
  auction list is a different row set from next year's — and adding season on
  top would be speculative. Reusing the same list next season means clearing
  it, which is what the manual **"Clear drafted"** in the options menu is for.

  **There is no draft-mode gate** (Chris, 2026-08-10). The drafted checkbox is
  **always available on any list** — it is permanent in side-by-side rows
  (handoff §"Side by side"), appears on hover in card view and stays once
  drafted (§"Cards"), and the row menu deliberately omits "Mark drafted"
  because the checkbox covers it. Drafted is a **visual treatment**: recessed
  row (`--surface-sunken`), dimmed to 45% in the pop-out. The legacy "Draft
  mode" toggle is a v1 concept and does not survive into v2.

  **Toggling a view control must never delete.** The legacy toggle-off called
  `clearDrafted()`, which was defensible while marks were throwaway browser
  state and is not now they are durable and cross-device. That single gesture
  is what R190, R195, R199 and R203 all orbited — four findings across three
  fix rounds, one root cause. Removed from the toggle at LV.1.3 (2026-08-10);
  **deleting is only ever explicit**, via "Reset list" / "Clear drafted",
  which keeps the read guard.

  **The 3-state board cycle is deleted, not preserved.** `use-board-marks.ts`
  (tap-cycle: *marked by me* / *drafted by others*, localStorage, keyed by the
  set of lists on the board) is superseded by the checkbox. Chris: *"I think
  there is a use case for that functionality but not at this time with our
  list feature."* This **amends the boards-off-limits rule** for that one file
  — see §1.

  Round 1 rewires **`use-draft-mode.ts`** (§2.1): its per-list semantics are
  already right; swap localStorage for the table.

- **D3 — Display preferences are session state, deliberately unsaved**
  (Chris, 2026-08-09). `view`, `cols`, cost-band labels and `budget` live in
  plain component/Zustand state with **no `persist` middleware and no
  columns**. They reset on reload, like a search filter. Do not add
  persistence "for convenience" — it was considered and declined.

- **D4 — Tier, round, cost and budget are one mechanism with four label sets**
  (Chris, 2026-08-09). They all behave exactly as tiers do today: a player sits
  in a bucket, and `org` decides whether that bucket renders as "Tier 1",
  "Round 1", or a cost band's editable label. There is no separate `round` or
  `cost` field.

  Storage is the existing `list_players.tier` (`text`), written through the
  existing `PATCH /api/lists/[id]/players/[playerId]/tier` route.

  **Erratum (v3.8, LV.4 Builder 2026-08-11) — "nothing is computed, and
  drag-to-bucket assigns in every mode, the same write in all four" was wrong
  about two of the four.** `screens/README.md` had already recorded half of
  this against the prototype's own model: `detail-grouping-budget-pct.png`
  computes Budget % from `Cost PPR`, and the prototype keeps a stored `tier` /
  `round` on the entry while *deriving* the cost bands from a price. LV.3
  shipped that way. So the mechanism is one shape with **two** sources:

  | Grouping | Bucket membership | A drop can assign it |
  | --- | --- | --- |
  | Ranked | array order | n/a — one section |
  | Tiers | stored `list_players.tier` ∈ S–F | **yes** |
  | Rounds | stored `list_players.tier` = `r1`…`rN` | not until **LV.1.5** widens the CHECK — refused with its reason |
  | Avg cost / Budget % | **computed** from `players.auction_value` | **no — there is nothing to write** |

  The consequence LV.4 had to take: in Avg cost and Budget %, dragging is not
  offered at all (the section re-sorts by price on every render, so a hand
  ordering would snap back), and the grip carries the reason. Bucket membership
  travelling with a shared list (§2.2, point 3) is unaffected — it was only
  ever true of the stored groupings.

  **Tier labels stay S/A/B/C/D/F** (Chris, 2026-08-09) — no change needed for
  tier mode, and `tailwind.config.ts` already carries the S–F color keys
  alongside `tier-1..7`.

  **Round mode needs more bucket keys than six, and that IS a schema change**
  — v3.4 and earlier claimed otherwise; **that was wrong** (erratum, LV.1.5
  Builder 2026-08-09). `list_players.tier` is `text` **but carries a live CHECK
  constraint** from migration `003_lists.sql:40-43`:

  ```sql
  CHECK (tier IS NULL OR tier IN ('S','A','B','C','D','F'))
  ```

  It is live locally **and on hosted production**. Widening the Zod enum alone
  would only move the rejection from a clean 400 to a Postgres `23514` surfaced
  as a **500 with a raw DB message**. A fantasy draft runs 12–16 rounds, so
  round grouping cannot represent a real draft against six buckets.

  **Ruled by Chris 2026-08-09: widen the CHECK.** This is the build's **second
  and final** schema exception (§1). One migration, `ALTER TABLE` only — no new
  table, no new column. S–F stays valid so nothing existing breaks.

  **Shipped at LV.1.5 (2026-08-11), migration
  `081_list_players_tier_vocabulary.sql`.** The vocabulary is
  `^([SABCDF]|r([1-9]|[12][0-9]|30)|c[1-4])$` — 40 keys plus `NULL` — mirrored
  by `BUCKET_KEY_PATTERN` / `bucketKeySchema` in `src/types/schemas/lists.ts`,
  which the tier route now imports instead of restating. The two layers are
  pinned to each other by `src/types/schemas/bucket-keys.test.ts`, which reads
  the migration off disk: **anything Zod accepts satisfies the CHECK and vice
  versa**, or that suite goes red. Rounds became drag-assignable in the same
  PR; cost and budget did not, and the reason is in D4's own erratum below —
  their membership is *computed*, so there is nothing to write.

  **`c1`–`c4` are accepted but nothing writes them today**, deliberately. They
  are the keys `DEFAULT_COST_BANDS` already uses, so every accepted key has a
  default label and `resolveBandLabel` can never render a raw key; and because
  the schema budget closes with this migration, provisioning them now costs one
  character class where adding them later would cost a fourth exception.

  A DB CHECK is also the strongest available guard on what a bucket key may be:
  it covers `duplicate_list`, which copies `tier` verbatim and never passes
  through the API's validation.

  Note the color ramp has 6–7 hues against up to 30 rounds, so round mode
  cycles colors rather than assigning a unique one per bucket. LV.1.5 made that
  literal: `bucket-colors.ts` maps a key to a ramp step, `r8` wraps back to
  step 1, and **an unrecognised key gets a named neutral fallback rather than
  `undefined`** — the two `Record<ListTier, string>` maps it replaced rendered
  an uncoloured band for every key 081 newly allows.

  Consequence: because buckets live server-side, grouping **does** follow a
  shared list. Only the label set is local.

- **D5 — Drag-and-drop uses the handoff's gap model** and measures with
  `offsetHeight`/`offsetWidth`. State updates only when the target slot
  changes — updating per `dragover` visibly janks.

- **D6 — Three server-side changes in Round 1, each named and each ruled.**
  (a) the `drafted` table and its route (D2/LV.1.2); (b) widening
  `list_players.tier`'s CHECK constraint plus the matching Zod enum
  (D4/LV.1.5); (c) the `list_links` table and its routes (D8/LV.8). Existing
  routes cover every other mutation. **These three are the whole budget** — a
  task that believes it needs a fourth has crossed out of scope: stop and
  raise it, do not proceed.

  *(v3.6 and earlier said "two". The third was ruled on 2026-08-11 — see D8.
  Note the pattern across all three: each was a real product need the UI-only
  framing could not hold, each was raised rather than improvised around, and
  each was ruled individually. That is the process working, not the budget
  eroding.)*

- **D8 — `list_links`: attribution, and the creator's own video**
  (Chris, 2026-08-11). Verbatim: *"lets create the table for storing the link,
  we need a way to link back to resources used and a way for creators to
  attached videos to their lists."*

  Two purposes, and they are the ceiling on the feature:

  1. **Attribution** — linking back to the resources a list drew on.
  2. **Creator video** — attaching a video to a list you made.

  Both are the author speaking about their own list, which decides the access
  rules: **reads follow the list's own visibility** (if you can see the list,
  you can see its links) while **writes are owner-only** (a link is the
  author's attribution, not a viewer's annotation). The read policy defers to
  `lists`' RLS through a bare `EXISTS`, the same form LV.1.2 landed and for the
  same reason — it covers 067's league-shared private lists for free, which a
  hardcoded `is_private = FALSE OR owner_id = auth.uid()` would silently
  exclude (R173).

  Storage is `list_links (id, list_id, kind, url, title, source_label,
  duration_label, position, created_at, updated_at)` — every column a fact
  `screens/detail-tab-details.png` actually renders. `position` is stored
  because the design shows an ordered list.

  **Nothing is scraped, fetched, or derived.** Titles, source labels and
  durations are typed by the person attaching the link. That is CLAUDE.md's
  standing rule (ingestion is plain fetch of RSS/YouTube feeds only), not a
  shortcut. Auto-filling a YouTube title/duration is a follow-up to **propose**,
  never to smuggle in.

  **The URL is guarded twice, because it renders as an `href` on the public,
  server-rendered share view (D7).** `links-service.ts` parses with the WHATWG
  `new URL()` and asserts the protocol is `http:`/`https:`; migration 080's
  `list_links_url_scheme_check` enforces `^https?://[^[:space:]]+$` at the
  database, so every future route, RPC or seed script inherits it. The DB layer
  is not redundant — `duplicate_list` is this codebase's standing proof that a
  write path which never sees Zod will eventually exist.

  **Duplicating a list does not copy its links.** `duplicate_list` (017)
  predates this table and was deliberately not modified — that is a scope call,
  not an oversight, and it is recorded so nobody rediscovers it as a bug.

- **D7 — The public share view stays server-rendered.**
  `/u/[username]/lists/[slug]` is SEO-critical per CLAUDE.md.

  *(Extended by LV.6, 2026-08-11 — three rules the original sentence implied and
  did not say.)*

  1. **The page is a server component; interaction may hydrate, content may
     not.** Every query runs on the server and the rows reach the browser inside
     the initial HTML. The v2 components under it are `'use client'` so their
     *controls* work, never so their content arrives late — `curl` with no
     cookies must return the players, and `public-share-view.test.ts` fails if
     the page ever gains a `'use client'` or a `useQuery`.
  2. **The handoff defines no share screen, so it is derived by subtraction.**
     The public view is the signed-in open list with everything a stranger
     cannot do removed — and it mounts the *same* components, never a fork.
     The line is **display stays, writes go**: grouping, view style, `Stats`
     and the budget are session-only state (D3) and a reader keeps them; every
     control that writes is gone.
  3. **A subtraction is the absence of the handler, not a no-op handler.**
     `ListBody`, `ListDetailsTab`, `ListToolbar` and `RowHandlers` take their
     write gestures as optional, and every affordance is gated on its
     permission flag **and** on its handler existing. Passing `() => {}` is the
     shape CLAUDE.md forbids — a later edit re-enables the control and nothing
     happens.
  4. **`canEdit` is not the only permission.** `RowHandlers.canMark` is the
     second: a drafted mark is per *viewer* (`list_player_drafted.user_id`,
     D2/LV.1.2), so "owner" and "has an account" are different questions and
     the share view answers `false` to both.
  5. **This page 500s where others degrade.** It is server-rendered, so a throw
     is an HTTP 500 rather than a blank component — which is why grouping goes
     through `buildBuckets` (total over `string`) and colouring through
     `bucketBandClass` (total over `string`), and why the bucket vocabulary is
     tested here in its own right.

- **D9 — One component for every tab and segment** (Chris, 2026-08-11).
  Verbatim: *"Could you standardize all the tab and segment UI controls to the
  same component? The one that's being used List / Cards / Side by side. There
  should be 3 variations of this — icons + label, label only, and icon only —
  × count. Count = # of lists for example. Right now I see like 3 or 4
  different versions of tabs. Let's use just that one."*

  **The three variations are content, not style**: an item takes an optional
  icon, an optional label and an optional count, and `count` is a modifier on
  any of them. All of it lives in `src/components/ui/tabs.tsx` — extended, not
  forked, per D1's absolute prohibition.

  **Two wrappers over one style source**, because the look is not the same
  thing as tab semantics:

  - `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` — Radix, kept wherever
    the usage is a genuine tab set (a `tabpanel` per trigger, roving focus,
    arrow keys). Visual uniformity is never bought by deleting those.
  - `Segment` / `SegmentItem` — presentational, for a mutually-exclusive picker
    with no panel to associate, or a tab row that *cannot* enclose its content.
    The Lists page header is the second case and it is structural, not a
    preference: `PageHeader` pushes the header into the app shell through a
    Zustand store, so a `Tabs.Root` around the control and its content is not
    expressible, and the same control also renders twice (desktop header and
    in-page below `lg`).

  Both key off the same `data-state` attribute — Radix writes it, `SegmentItem`
  writes it by hand — so exactly one CVA states a colour.

  **Frame follows role; colour never changes.** `appearance="boxed"` is the
  joined ink-bordered segment and `"bare"` the un-framed chip row. Both are in
  `screens/list-rail-list-view.png` **side by side**: List / Cards / Side by
  side and the view-style toggle are boxed; `My lists 7 / Saved 2` and
  `List / Details / Comments 0` are bare. Active is an accent fill with white
  text in *both*.

  **The screenshot overrules the handoff prose here**, on the §7-gap-4
  precedent. The prose says chip tabs are *"active = `--accent` text"*; the
  screenshot fills them. It also overrules `ui/tabs.tsx`'s former comment
  (*"content tabs select to black; accent/blue is reserved for do-a-thing
  controls"*) — the design LAW lists **selection** under accent, and the
  styleguide's own caption had said "active is accent fill with white text"
  since the reskin while the primitive rendered ink.

  **Out of scope, deliberately — superseded for the single-select case by D10.**
  `FilterChip` rows (`ui/badge.tsx`) are a different shared component with a
  different job and a deliberate ink-fill selected state; several are
  single-select and could arguably be segments, but converting them is a design
  change nobody asked for and it would blur "filter" against "tab". *(Chris
  ruled on that question the same day — see **D10**. The multi-select rows stay
  out of scope permanently; the single-select ones came in.)* Navigation
  (`bottom-tabs.tsx`, the sidebar), steppers and radio-card pickers are not
  segments either. `week-tabs.tsx` and `public-big-board.tsx`'s week strip are
  the same look again and are **off limits** — recorded for whichever task
  reopens boards.

- **D10 — Single-select filter rows use the tab component, *for now*** (Chris,
  2026-08-11). Verbatim: *"Use the tab component for now, we can create one for
  filters later."* This answers the question D9 deliberately left open.

  **It is a temporary unification and the plan says so on purpose.** A
  purpose-built filter control is still wanted; until it exists, a row that is
  genuinely one-of-many wears the segment. The rows that borrowed it are listed
  in `ui/tabs.tsx`'s header and are the first candidates to move back — that
  list is the hand-off to whoever builds the filter control, and it is in the
  code rather than only here so it cannot be missed.

  **The line is one-of-many, and it is a behaviour rule, not a taste rule.** A
  segment asserts that **exactly one item is active**. Two shapes therefore stay
  on `FilterChip`, and converting either would be a regression wearing a
  restyle:

  1. **Multi-select** — several on at once.
  2. **Single-select where zero selected is valid** — tapping the on chip clears
     it and nothing is active. The research rail's position row (clear = all
     positions) and the AI modal's optional expert picker are both this.

  `src/components/ui/filter-chip-split.test.ts` pins the split: every file that
  still imports `FilterChip` must be on an allow-list **with one of those two
  reasons**, and every converted file must import the shared control.

  **Frame follows role, as in D9.** Fixed, known option sets are `boxed`. Where
  eight options overflow a phone, the group is a `grid` (4×2) rather than a
  wrapping flex row, which strands the last option alone on a second line.

- **D12 — In Side by side, the drafted checkbox fans out across the columns
  you picked. Never globally.** *(Round 2, added v5.0.)*

  The handoff and the screenshots both show one mark striking a player through
  in **every** column at once — the Interactions table says *"Marks drafted in
  every list containing him"*, the store calls it `toggleDrafted` (global), and
  `side-by-side-columns.png` shows Malik Nabers struck in all five columns. The
  picker's own copy promises it: *"Mark players off as they go in your draft
  and every column updates."*

  **That prose is overridden, and the screenshots with it**, by Chris,
  2026-08-10: *"marking a player as drafted is per user, per list. it's not
  some global app wide thing. players will have multiple lists for multiple
  leagues. it makes no sense to persist that."* Per
  `docs/design/lists/screens/README.md`: *screenshots outrank the prose, they
  do not outrank Chris.*

  The two reconcile exactly, and this is the rule:

  > **The comparison set *is* the draft.** Ticking a player writes one
  > `list_player_drafted` row per list **currently in the comparison** — which
  > is every column on screen, so the promised behaviour holds — and touches
  > **no** list outside it. Next week's league is a different comparison, and
  > is untouched.

  Consequences a Builder must handle rather than discover:

  1. **Storage does not change.** This is N writes to the LV.1.2 table through
     the LV.1.2 route, keyed `(user_id, list_id, player_id)` as shipped. **No
     new table, no new column, no new route** — the schema budget stays closed
     at three.
  2. **A player in only some columns marks only those.** The fan-out is
     `columns ∩ lists containing the player`, not all columns.
  3. **Partial failure must not lie.** If three of five writes land, the UI may
     not show all five struck. This build has already paid for the general
     version of this mistake three times (R190/R195/R199) — the guard takes its
     input from the write actually returning, and a failed write rolls its own
     column back and says so.
  4. **Unticking is symmetric** — it clears across the same set, no wider.
  5. **The single-list detail panel is unchanged.** Ticking there writes one
     row, exactly as LV.1.3 shipped. Only the comparison fans out.

  The live `N of M left` count in each column header is derived per column from
  that column's own rows, so it stays correct under any fan-out outcome,
  including a partial one.

- **D13 — Pop-outs persist their geometry, never their existence**
  *(Round 2, added v5.0.)*

  `src/stores/player-windows-store.ts` already settled this shape for the
  player mini card and Round 2 follows it rather than inventing a second
  convention: an array ordered back-to-front as the z-stack, one window per id,
  re-opening refocuses instead of duplicating, and `partialize` persists
  **positions only**. A reload leaves you on a clean page; re-opening a list
  puts its window back where you left it. Round 2's store adds size and
  minimize to what is remembered (handoff: `popouts[{id,x,y,w,h,z,min}]`) and
  keeps `windows` out of storage on the same reasoning.

  This is consistent with D3 — display state is not saved — and with the one
  exception to it: `drafted` is real data, and a pop-out reads the same server
  source as everything else.

  **The app-shell host is the one part of Round 2 that can break surfaces
  outside Lists**, since it mounts on every route. It renders **nothing** —
  no wrapper, no portal, no layout box — when no window is open, and that is a
  test, not an intention.

- **D14 — Side by side has no ceiling and no phone variant.**
  *(Round 2, added v5.3. Ruled by Chris 2026-08-11 — `PROGRESS-lists-v2.md` §3
  **Q4**, filed by the LV.12 fix-round Builder from review finding R212.)*

  **No cap, no search field, no truncation.** The picker offers every list the
  account holds, the CTA commits every pick, and the column scroller is as long
  as it is. Q4's own recommendation ended *"B when LV.13 lands"* — a cap on the
  comparison — and that clause is **overtaken**: a limit of any kind now needs a
  fresh ruling, not Q4.

  **No phone-specific treatment either** — *"id say leave the phone version as
  is"*. The 240px columns and the full-bleed horizontal scroller are the same at
  every width; you scroll sideways through the columns on a 375px screen, and
  that is the intended behaviour rather than a gap. No stacking, no breakpoint
  width override, no desktop-only empty state.

  What this does **not** excuse is verification. The ruling is about what to
  build; LV.13 still checked 375px and proved the things that would be real bugs
  — the strip scrolls with touch, the page body does not scroll horizontally
  (the full-bleed `margin`/`padding` trick is exactly where that leaks), and the
  header actions wrap rather than collide. Both halves are pinned by
  `src/components/lists/v2/side-by-side-columns.test.ts`, so the "fix" this
  decision declines cannot arrive later as a tidy-up. **The no-stacking half of
  that pin was widened at the LV.13 review (R218)**: it originally forbade only
  `lg:flex-col`, which left `flex flex-col lg:flex-row` — the mobile-first
  spelling of the same stacking, and the one a developer actually reaches for —
  passing green. Both spellings are now forbidden, shown red and reverted.

---

## 4. Task breakdown (dependency order)

One task = one Builder session = one PR. `/build-next` drives.

**Phase 1 — foundations**

| id | task | depends on |
| --- | --- | --- |
| LV.1.1 | `featureFlags.listsV2` + route-level branch so old and new Lists coexist | — |
| LV.1.2 | **Migration**: `list_player_drafted (user_id, list_id, player_id)` + RLS + indexes, and its read/toggle route (D2). Satisfies checklists §8.1–8.2; reaches production via `npx supabase db push`, never by hand | — |
| LV.1.3 | Point **`use-draft-mode.ts` only** at the new server source (D2). Do not open `board-labels-store.ts` or `use-board-marks.ts` | LV.1.2 |
| LV.1.4 | Session-only display state — `view`, `cols`, band labels, `budget`. **No `persist` middleware** (D3) | — |
| LV.1.5 | **Migration `081_list_players_tier_vocabulary.sql`** — widen `list_players_tier_check`, and the tier route's Zod enum with it (D4). **S–F stays valid** — tier labels are unchanged. Satisfies checklists §8.1–8.2; reaches production via `npx supabase db push`, never by hand | — |

**Phase 2 — Lists page**

| id | task | depends on |
| --- | --- | --- |
| LV.2.1 | Page header: heading, view-mode segmented control, My lists / Saved tabs, New list. Resting/hover/active colors in **CSS classes, not inline styles** — the handoff's critical note: an inline `background` outranks `:hover` and silently kills it | LV.1.1 |
| LV.2.2 | Rail mode — 200px sticky rail, shared edge (no gap), selected-row treatment | LV.2.1 |
| LV.2.3 | Cards mode — responsive gallery, flat at rest, lift on hover | LV.2.1 |

**Phase 3 — list detail**

| id | task | depends on |
| --- | --- | --- |
| LV.3.1 | Hero: cover, inline rename (hover pencil, owner-only, Enter saves / Esc cancels, no modal), byline, action cluster, options menu | LV.1.1 |
| LV.3.2 | Tabs (List/Details/Comments) + toolbar: bare-select grouping dropdown, view-style toggle, Stats, Add players | LV.3.1, LV.1.4 |
| LV.3.3 | View style: List — 60px rows, stat cells, computed `minWidth = 330 + cols·72`, section cards | LV.3.2 |
| LV.3.4 | View style: Table — 44px rows, sticky header | LV.3.2 |
| LV.3.5 | View style: Cards — corner cells, stat strip, first-three-stats rule, 62px label rail for grouped lists (none when simply ranked) | LV.3.2 |
| LV.3.6 | Drag-and-drop across all three views (D5); drag onto a section header assigns that bucket — same write in all four grouping modes (D4) | LV.3.3–3.5, LV.1.5 |
| LV.3.7 | Stats picker modal — grouped catalog ordered by this list's coverage, search, reorderable chips | LV.3.2 |
| LV.3.8 | Notes: accent `comments` mark, body-portalled hover card clamped to the viewport | LV.3.3 |
| LV.3.9 | Drafted checkbox wired to the server source (D2) + "Clear drafted" in the options menu | LV.1.3, LV.3.3 |

**Phase 4 — states and cutover**

| id | task | depends on |
| --- | --- | --- |
| LV.4.1 | Loading / empty / error / overflow states across both screens | LV.3.* |
| LV.4.2 | AI list generation + persona surfaces restyled into the new language (CLAUDE.md: never leave them in the old style, never remove them) | LV.3.* |
| LV.4.3 | Public share view in the new language, still server-rendered (D7). **UI only** — the schema budget stays closed at three | LV.3.* |
| LV.4.4 → **LV.7** | **DONE 2026-08-11.** Flag removal + retire the old components — including deleting `use-board-marks.ts` and the old `/app/lists/draft-mode` 3-state cycle (D2; §1's boards amendment scopes this). R192's now-false header **discharged by deletion**, not by a fix. Preceded by the capability diff that PROGRESS §3 Q3 records, and by Chris's ruling that **four capabilities are ported rather than dropped** — see **D11** | all |

**Phase 5 — attached links** *(added v3.7, ruled 2026-08-11)*

| id | task | depends on |
| --- | --- | --- |
| LV.8 | **Migration `080_list_links.sql`** + RLS + indexes, the `/api/lists/[id]/links` routes (add, remove, reorder), and the Details tab wired to them (D8). Satisfies checklists §8.1–8.2; reaches production via `npx supabase db push`, never by hand | LV.3 |

**Phase 6 — the shared control** *(added v3.9, ruled 2026-08-11)*

| id | task | depends on |
| --- | --- | --- |
| LV.9 | **One tab/segment component** — three variations × count, in `src/components/ui/tabs.tsx`; the hand-rolled Lists v2 controls converted onto it, the genuine tab sets kept on Radix and restyled, and all three variations added to the styleguide (D9). **UI only** — the schema budget stays closed at three | LV.2, LV.3 |
| LV.11 | **Single-select `FilterChip` rows onto that control** (D10). Survey every call site, classify each single-select / multi-select / zero-selected-is-valid, convert only the first kind, and pin the split with a test. **UI only** — the schema budget stays closed at three | LV.9 |

---

## 5. Definition of Done (per task)

1. `npm run type-check` and `npm run lint` clean — **shown, not claimed**.
2. `npm run test:unit` green. `share-link-permanence.test.ts` stays green.
3. **No migration, no schema change, no new API route** outside the three named
   in D6 (LV.1.2's `drafted` table + route, LV.1.5's **CHECK widening**, LV.8's
   `list_links` table + routes). **All three are now spent.** A task that thinks
   it needs more has left scope: raise it, do not proceed.
   LV.1.2, LV.1.5 and LV.8 additionally satisfy checklists §8.1–8.2 (RLS,
   indexes, `IF NOT EXISTS`, banner comment citing the ruling) and reach
   production via `npx supabase db push` — **never** by hand (CLAUDE.md
   migration discipline).
4. Verified in the browser preview with a screenshot at desktop **and** mobile.
5. `PROGRESS-lists-v2.md` updated.
6. Small commit citing the handoff section; branch + PR, never direct to main.

---

## 6. Round 2 — **ACTIVE from 2026-08-11** ("round 2, go" — Chris)

Side-by-side compare, and pop-out windows. **The new side-by-side is where
draft night actually happens** — its rows carry a permanent drafted checkbox
(handoff §"Side by side"), so it writes real account-persisted marks rather
than the browser-only tap-cycle the old board used. Both stay UI-only:
`player-windows-store.ts` already models floating windows with positions
persisted across reloads and back-to-front z-ordering, which is most of the
pop-out infrastructure. Pop-outs are hosted by the **app shell** so they
survive navigation — the only part of this package that can destabilize
surfaces outside Lists.

**Round 2 adds no schema.** The budget stays closed at three (§1). Side by
side writes through the LV.1.2 table and route; pop-outs are client state.
A task that believes it needs a fourth exception has left scope: stop and
raise it, as LV.1.2 / LV.1.5 / LV.8 each did.

**Round 1 is the floor, not the ceiling.** Both screens reuse what already
exists rather than growing a third tree — `list-buckets.ts` for grouping,
`list-row-parts.tsx` for rows, `cover-tile.tsx` for covers, `use-draft-mode.ts`
for marks, `use-list-drag.tsx` for reordering, `Segment` for the mode control.
D11 applies with full force: **a new surface that quietly reimplements a solved
behaviour is the failure this build already paid for once.**

**Phase 7 — Side by side**

| id | task | depends on |
| --- | --- | --- |
| LV.12 | **Picker** — replaces `SideBySidePlaceholder`. Heading "Pick the lists to compare", 232px-min grid of selectable cards (16px checkbox, accent fill when on; 30px `CoverTile`; name; `N players`), primary button reading `Show N lists side by side` and disabled as `Select at least one list` at zero. Selection is **session-only** (D3). ~~Honours the My lists / Saved tab~~ — **see the erratum below**. **LANDED 2026-08-11** | LV.9 |
| LV.13 | **Columns** — 300px fixed panels in a **full-bleed** horizontal scroller (`margin: 0 -36px; padding: 0 36px 8px`). Column header: 26px cover, name, live `N of M left`, `dots` menu = the five grouping modes (**each column groups independently**) + `Remove column` under a separator. 38px rows: permanent drafted checkbox, `#N`, name → mini card, position badge, team. Tier/round band headers carry their colour through. `Change lists` appears in the page header beside `New list`, and **`ComparisonPending` in `lists-page-v2.tsx` is deleted** — LV.12 shipped it as an explicitly temporary branch and this row is where it goes (see the erratum below). **LANDED 2026-08-11** — 300px → **240px** at this app's ×0.8, and the full-bleed margin is pinned to the shell's own gutter (`-mx-4 px-4 / lg:-mx-7 lg:px-7`) rather than to a converted number, because the two have to move together or the page gains a horizontal scroll | LV.12 |
| LV.14 | **Drafted fan-out (D12)** — one tick writes across every column in the comparison that contains the player, and no further. Per-column rollback on a partial failure; the header count derived per column. Reuses the LV.1.2 route; **no new route**. ~~**This task discharges a live-but-false promise**~~ — **discharged**: the picker's sub-line (*"…and every column updates"*) had shipped since LV.12 and was true only from LV.14 (LV.13 review, **R220**); LV.14 made it true, and cleared the interval note from `side-by-side-picker.tsx`'s JSDoc and from `PROGRESS-lists-v2.md` §4. **The copy was not edited** — the fix was the behaviour. **LANDED 2026-08-12** — the mechanism is `src/components/lists/v2/drafted-fan-out.ts`, a **`.ts` on purpose** so D12's set intersection and its partial-failure protocol are *executed* rather than source-pinned (no jsdom here, R191). Columns **register**; they are not lifted. `use-draft-mode.ts` gained `setDrafted` + `desiredDraftedFor`, and its mark mutation was extracted to `markMutationOptions` so the per-column rollback is driven through five real caches instead of argued from cache-key shape | LV.13, LV.1.3 |

> **Erratum (v5.1, LV.12 Builder 2026-08-11) — the picker does *not* honour the
> My lists / Saved tab, and the v5.0 row that said so was wrong against the
> design package.** The prototype reads
> `st.myLists().concat(st.savedLists())` (`docs/design/lists/design/ListsScreen.jsx:431`)
> and never consults `st.tab`; the same file **hides the tab control entirely in
> compare mode** (`:49`), which the shipped page already did too; and
> `screens/side-by-side-picker.png` renders **9** cards, which is exactly the
> prototype's 7 own + 2 saved lists, own first. Design LAW outranks this plan
> (`PROGRESS-lists-v2.md` header) and screenshots outrank prose
> (`screens/README.md`), so the picker offers **every list on the page**.
>
> The clause was not merely unsupported, it was a trap: with no tab control on
> screen there would be no way to change the filter, so a viewer on *My lists*
> could never compare a saved board and one on *Saved* could never compare their
> own — and comparing your board against someone else's is the reason the mode
> exists. Pinned by `src/components/lists/v2/side-by-side-picker.test.ts`, which
> goes red if the filter is reinstated (shown failing, then reverted).
>
> **`Change lists` remains LV.13's**, but the state it toggles is LV.12's:
> `compareIds` lives in `lists-page-v2.tsx`, which renders both the page header
> and the body, so the header button and the body branch read one value.
> **LV.12 also ships a deliberately temporary `ComparisonPending` panel** for
> the chosen-but-not-yet-rendered state — without it the picker's primary CTA
> would commit a comparison and change nothing on screen. LV.13 deletes that
> function and replaces its branch with the columns.

**Phase 8 — Pop-out windows**

| id | task | depends on |
| --- | --- | --- |
| LV.15 | **The host and the store (D13)** — `list-windows-store.ts` (`{id,x,y,w,h,z,min}`, `partialize` → geometry only), and the **app-shell host**. Drag anywhere on the 44px header; resize grip 16px bottom-right, clamped 330–1200 × 220–900; collapse; close; back-to-front z-ordering; survives navigation. **Renders nothing at all when no window is open — pinned by a test**, because this is the one Round 2 file that mounts on every route. **LANDED 2026-08-12** — the store is `player-windows-store.ts` line for line where it can be, plus `w`/`h`/`min`; **the handoff's `z` is the array index**, not a stored field, because two sources of truth for stacking mean the one that is *not* the render order silently wins (D13 asks for the array, and the store header maps every handoff field to where it lives). 44px → **36**, `440 × 520` → **352 × 416**, `330–1200 × 220–900` → **264–960 × 176–720** at this app's ×0.8 — but the **16px grip is not converted** (a hit target, not a rhythm measure) and the pointer maths has no `/ ZOOM` (this app has no zoom to undo). Pop-outs are **one** z layer at **45**: above page chrome, below Radix (50) so LV.16's `dots` opens above its own window, and below the player mini cards (60) so a card opened *from* a row lands in front. `gear` and `dots` are **absent rather than inert** (R220) and the body is a marked `ListWindowBodyPending` — both are LV.16's, filed as **F-LV15.1/2** rather than left implicit | LV.7 |
| LV.16 | **Window content** — the dark inversion done by scoping the colour custom properties on an **inner wrapper** (children invert without restyling), with the Stats modal deliberately rendered **outside** it. 36px rows, 14px checkbox, name **13px/400**, drafted dims to 45%, hover `rgba(255,255,255,.09)`. Drag-reorder via the existing `use-list-drag.tsx` gap model. Footer: views / comments + a brand-lime Share with **literal `#000`** text (inside the wrapper `--n-1` resolves to white). **Outer stroke 1.25px, no shadow** — see the elevation note below. **This row discharges LV.15's two hand-offs** (PROGRESS §5): **F-LV15.1** — delete `ListWindowBodyPending` from `list-window.tsx` outright and replace its branch with the inversion wrapper, as LV.13 deleted LV.12's `ComparisonPending`; and **F-LV15.2** — add the `gear` (stat picker) and `dots` (grouping menu) the design LAW's header lists, which LV.15 left *absent rather than inert* (**R220**) because each needs what this task brings. The `dots` menu is a compose, not a build: `list-display-store`'s `setOrg` + `ORG_OPTIONS`, exactly as `side-by-side-columns.tsx` does it. **LANDED 2026-08-12** — the wrapper is one `fs-dark` div and its five values are custom properties in `globals.css`, with a short, enumerated redirect for the palette utilities that appear inside a pop-out, **because this app's palette is literal hex in `tailwind.config.ts` rather than custom properties** (see the changelog and PROGRESS §4; `text-ink` is deliberately *not* inverted, since here it means "ink on a light fill"). 36px rows → **29** at ×0.8, the 14px checkbox unconverted, name **10.5px Regular**. `use-list-drag.tsx` runs the gesture and what a drop *writes* moved out of `list-detail-panel.tsx` into **`use-list-drop.ts`**, verbatim, so the two surfaces cannot drift. **Both hand-offs discharged**, and a tick here is **one tick on one list** — measured, with a list holding the same player gaining 0 | LV.15 |
| LV.17 | **Wiring and states** — `pop out` in the detail hero action cluster and in the column menu; loading / empty / error **inside** a window; what happens at 6+ windows; a pop-out of a list you then delete; and the mobile answer (a floating draggable window has none — say what small screens get instead). **LANDED 2026-08-12 — Round 2 is complete.** Both entry points go through one `list-windows-store.open`, and popping a column out **does not remove it** (the comparison set is what a tick fans out over, D12). The states are `error → !entries → empty → rows` — LV.13's order, and the order the data forces, since an errored read keeps its last good `data`; `ListReadFailure` and `ListRowsSkeleton` moved into `list-row-parts.tsx` so the column and the window cannot spell one situation two ways. ~~**A deleted list keeps its window and says so**~~ and ~~**the phone answer is "the same window"**~~ — **both were Builder decisions and Chris overruled both on 2026-08-12 (§1, PROGRESS §3 Q5/Q6); the fix round rebuilt them.** A pop-out of a list that is gone now **closes with a neutral toast**, and a phone gets a **real bottom-sheet variant**. **6+ = no cap** (Q4's ruling, one screen along); the cascade wraps after six, measured with seven open at one z layer — and on a phone the pile is geometrically identical windows unwound one `Close` at a time, still with no cap. **F-LV15.3 stays discharged** — the *size* half of LV.15's fit, and the grip started from the painted corner, are the desktop answer and are untouched. One change reaches outside the diff and is stated: `useList` no longer retries a **404** — narrowed from `< 500` at **R252**, and the premise recorded for it (*"the state was not reachable at all"*) was **false and is corrected at R249**: it was reachable one retry later | LV.16 |

**Elevation, for the avoidance of doubt.** A pop-out is a true overlay, so
CLAUDE.md's rule would let it carry a resting shadow — but the handoff
overrides that on its own terms: *"a black offset shadow can't read on a black
window, so the stroke carries the lift."* Resting elevation on a pop-out is
therefore a **1.25px `--text-secondary` stroke shifting to `--brand` on
hover**, and `src/components/ui/elevation-rule.test.ts` is not touched — the
window is not a `ui/` primitive.

**Where Round 2 must not go:** `src/components/big-board/**`,
`src/stores/board-labels-store.ts` (still off limits, §1), and any leagues
surface. Side by side is a *Lists* draft aid; it is not M2.

---

## 7. Open questions for Chris

*(Q1 — Round 1 scope — is resolved: page + detail first, then side-by-side and
pop-outs. Ruled by Chris 2026-08-09.)*
*(All prior open questions are resolved. Display prefs deliberately do not
persist. `drafted` does — server-side, per user per list, overriding the
handoff's global rule (§2.1). Round 1 scope, tier labels, visibility and
grouping are all ruled in §1 and §3.)*

**Nothing is blocking. `/build-next` can start on LV.1.1.**

*(v1.0's Q1 — "what clears `drafted`" — is resolved: the manual "Clear
drafted" in the options menu. Per-list scoping means a new draft is a new
list, so nothing accumulates across seasons on its own. See D2.)*

## Changelog

- **v6.1 (2026-08-12)** — **Chris amended the mobile ruling, and one claim this
  plan made was false.** Both come out of LV.17's third review (R256–R259).

  **A third ruling, in §1.** *"add tap outside to dismiss but also the bottom
  should be right at the top of the bottom bar"* (Chris, 2026-08-12). v6.0's
  sheet was anchored at the viewport floor and **completely covered the bottom
  tab bar** — nav `[0, 748, 375, 64]` under a sheet `[0, 324.8, 375, 487.2]` at
  375 × 812 — so a phone user could not navigate at all with a pop-out open, and
  the header `Close` was the only way out. The sheet now rests on the bar
  (`[0, 260.8, 375, 487.2]`, bottom edge flush at 748) and an outside tap
  dismisses the **top** sheet without swallowing the tap, so a tab both navigates
  and dismisses. **The 60% is still of the viewport, as ruled.** Desktop is
  untouched: an outside click there closes nothing, which is pinned.

  **And the correction: *"no geometry is written from a phone"* was false**
  (**R257**), here in the v6.0 entry and in five other places including the
  component that claimed it. `Collapse` — the item v6.0's own ruling moved into
  the Options menu — writes `min` into the persisted `geometry[listId]` record,
  so collapsing a sheet and widening past 768 returns a collapsed desktop
  window. The write is **kept** (it is the same promise position and size make,
  and removing it would change desktop behaviour no ruling asked to change) and
  the claim is narrowed to **no position or size**, with a pin that fails if a
  third writer of either ever appears.

  No scope, dependency, schema or D-decision changed; the budget is still closed
  at three, and no route was opened (**F-LV17.6** carries the one change that
  would have needed one).

- **v6.0 (2026-08-12)** — **Chris ruled on both of v5.9's two decisions, and
  reversed both.** They are now rulings in **§1** rather than a Builder's
  reasoning in a changelog entry, and §6's LV.17 row is struck through where it
  described the overruled behaviour.

  **(a) A pop-out of a list that is gone closes, with a toast.** *"Close it,
  with a toast."* The toast reads **"This list is no longer available."** That
  lands on the prototype's own `store.destroy` (`design/lists.js`:253) — v5.9
  argued the divergence from persistence and lost, which is the right outcome:
  the LAW's *"stay until closed"* is about **navigation**, and a window over a
  list nobody can read is not a window that is still doing its job.

  **The neutral copy is not a paraphrase — it is also the fix for a false
  statement the app was making.** A 404 from `GET /api/lists/[id]` collapses
  three situations, and only one is a deletion: the third is a list that is
  **alive with `deleted_at` NULL and merely no longer visible to this viewer**,
  which the owner produces with one click in the hero's visibility control.
  Measured on the local stack: the public `LV12` fixture flipped to
  `is_private = true` → the viewer's pop-out closed with the neutral toast,
  where the shipped code would have said *"Its owner deleted it."* No surface
  may name a cause the client cannot see (**R248**).

  **(b) Pop-outs get a real mobile variant.** *"On a mobile the pop out window
  is full width but only 60% of the screen height. the tool bar only shows Close
  and Options. All options go into the option menu."* Below **768px** — one
  breakpoint, `WINDOW_MOBILE_MAX_W`, executed by a store test rather than
  sprinkled as `md:` variants. v5.9's *"the phone gets the same window"* was a
  Builder decision explicitly offered for overruling, and was overruled.

  **This does not disturb D14.** *"Leave the phone version as is"* was ruled
  about **Side by side** and still governs it; that this build refuses to infer
  one surface's ruling onto another is what left the pop-out question open for
  Chris to answer, and it is why the two answers can differ.

  **Three things Chris did not state were decided by the Builder and are flagged
  derived-not-ruled** (PROGRESS §4): the sheet is **bottom-anchored**; **drag
  and resize are switched off** on a phone rather than left as dead gestures,
  and ~~no geometry is written from one~~ **no position or size is written from
  one** *(corrected at v6.1 — **R257**: `Collapse`, the item this very ruling
  moved into the Options menu, writes `min` into the persisted geometry record.
  The claim was false here and in five other places)*; and **several windows
  pile** with no cap invented (Q4's precedent is that Chris rules caps), filed as
  **F-LV17.4**.

  Desktop is bit-identical and that is under test. No scope, dependency, schema
  or D-decision changed.

- **v5.9 (2026-08-12)** — **⛔ BOTH DECISIONS IN THIS ENTRY WERE OVERRULED BY
  CHRIS THE SAME DAY — see v6.0 above.** Left unedited as the record of what was
  built and argued, because v6.0 engages with the reasoning rather than replacing
  it silently. **LV.17 landed and Round 2 is complete.** Two things
  in that row are decisions rather than implementation, and both are recorded
  here because a later reader will otherwise re-litigate them from the design
  package. **(a) A pop-out of a deleted list stays and says so.** The prototype
  removes it (`design/lists.js`:253); the README's persistence bullet says
  pop-outs *"stay until closed"*, the prototype is a single-actor in-memory demo
  with no soft delete and no Trash, and this app's host is mounted app-wide, so
  the delete routinely happens on a screen the window is not on. A window that
  vanishes without a word is CLAUDE.md's *"nothing happened"* with the evidence
  removed. **(b) The phone gets the same window** — no breakpoint, and the
  `pop out` control is not hidden below any width. Chris's *"leave the phone
  version as is"* (D14) was ruled about **Side by side** and is deliberately not
  extended; the answer stands on its own three verified properties instead
  (a window the store places opens whole; the gestures are pointer, therefore
  touch; the grip reads the painted box). Hiding the control below a breakpoint
  remains available to Chris as a one-line change and was **not** taken
  unilaterally. Nothing in the LAW is wrong; no scope, dependency or decision
  changed.

- **v5.8 (2026-08-12)** — **LV.16 landed**, and the §6 row records the one thing
  the task could not do the way the LAW words it. *"Scope the colour custom
  properties on an inner wrapper"* assumes the prototype's design system, where
  every colour **is** a custom property; this app's Field Scout palette is
  **literal hex in `tailwind.config.ts`**, so the wrapper declares the LAW's five
  values as properties and the palette utilities that appear inside a pop-out are
  pointed at them — the LAW's *mechanism* (children invert with no per-child
  restyling), against a token layer that is not var-backed. Re-tokenizing the
  palette is the alternative and is post-launch: it changes ~470 call sites and
  drops the alpha on the 14 that use opacity modifiers. Recorded here rather than
  as an erratum because nothing in the LAW is **wrong** — the sentence is an
  implementation instruction, and PROGRESS §4 carries the three options and why
  this one. No scope, dependency or decision changed.

- **v5.7 (2026-08-12)** — **LV.15's review round: the LV.16 row now carries the
  two hand-offs it owns** (**R230**). `F-LV15.1` (delete
  `ListWindowBodyPending`) and `F-LV15.2` (add the `gear` and `dots` the design
  LAW's header lists) both name **LV.16** as owner in PROGRESS §5, and both were
  missing from §6's LV.16 row — the line `ACTIVE-BUILD.md` points a Builder at.
  This is **R209's finding for the third time** (LV.12 → LV.13's
  `ComparisonPending`, then LV.13 → LV.14's live-but-false sub-line): an
  obligation recorded everywhere except the successor's own row is an obligation
  that gets missed, and LV.15 stated both only in the *predecessor's* file
  header and in §5. Editorial plus two forward obligations: no scope, dependency
  or decision changed, and **D13 is still unamended**.

- **v5.6 (2026-08-12)** — **LV.15 landed; Phase 8 is open.** §6's LV.15 row is
  marked LANDED and carries the four things a reviewer would otherwise have to
  reconstruct: (1) **where the handoff's `z` went** — it is the array index, not
  a stored field, which is D13's *"array ordered back-to-front as the z-stack"*
  taken literally rather than stored twice; (2) the **×0.8 conversions and the
  two numbers deliberately exempt from them** — the 16px resize grip is a hit
  target, not a rhythm measure, and pointer deltas are physical viewport pixels
  with no zoom to undo; (3) **the z-layer choice between the two windowing
  systems now in the app** — pop-outs at 45, Radix at 50, player mini cards at
  60, one number for the whole pop-out layer so a sixth window cannot climb into
  the dialog layer; and (4) that `gear` / `dots` and the window body are
  **LV.16's**, absent rather than shipped inert (R220), and filed as
  **F-LV15.1/2** in PROGRESS §5 rather than left as a note in the previous
  Builder's file (R51). **D13 is unchanged** — it was written before the task
  and survived the build without an erratum, as D12 did one task earlier.
  PROGRESS §5 also carries **F-LV15.3**: LV.15 fitted the *cascade* to the
  viewport, because the design's `120,120` origin puts a 352px window's own
  close button off a 375px screen — and everything else about phones is
  **LV.17's**, since D14's *"leave the phone version as is"* was a ruling about
  Side by side, not about pop-outs.

- **v5.5 (2026-08-12)** — **LV.14 landed, and the promise v5.4 recorded as an
  interval is discharged.** §6's LV.14 row is marked LANDED and its R220 clause
  struck through rather than deleted: the picker's sub-line described behaviour
  the build did not have between LV.12 and LV.14, and the record of *why the
  copy was left alone anyway* is worth more than a tidy row. The row now also
  names the two structural choices a reviewer would otherwise have to
  reverse-engineer — that the fan-out is a **`.ts`** so D12's decisions are
  executed rather than source-pinned (this repo's vitest has no jsdom, R191), and
  that columns **register** with it rather than being lifted into it, which is
  what keeps the per-column optimism/rollback/invalidation LV.1.3's instead of a
  second copy (**D11**). **D12 itself is unchanged** — it was written before the
  task and survived the build without an erratum, which is the outcome a
  decision-first plan is for.

- **v5.4 (2026-08-12)** — **LV.13's review round: D13 gets its conclusion back,
  and LV.14 inherits a promise the copy is already making** (**R217**, **R220**).
  D14 was inserted *between* D13's body and D13's closing paragraph, so
  *"the app-shell host renders nothing when no window is open"* — a statement
  about LV.15 — ended up reading as part of a decision about column caps and
  phone variants. The paragraph is moved back above the D14 bullet, where it has
  been since v5.0; nothing was lost in the meantime (`ACTIVE-BUILD.md` and §6's
  LV.15 row both carry the clause), but D13 was left without its conclusion and
  D14 ended on a non-sequitur. **§6's LV.14 row additionally now carries the
  R220 obligation**: the picker's design-verbatim sub-line has promised *"every
  column updates"* since LV.12, and as of LV.13 that is **live and false** — one
  tick moves one column. Nothing prompted it before, because before LV.13 there
  were no columns to contradict it. LV.14 discharges it by making the sentence
  true and clearing the interval note; the copy itself is not to be edited.
  D14's own text also records that its no-stacking pin was widened (**R218**).
  Editorial plus one forward obligation: no scope, dependency or decision
  changed.

- **v5.3 (2026-08-11)** — **LV.13, the columns, landed, and §3 gains D14** —
  the two rulings Chris took on Side by side's scale the same day
  (`PROGRESS-lists-v2.md` §3 **Q4**): **no cap, no search field, no truncation**,
  and **no phone-specific treatment**. Both are now decisions rather than open
  questions, so a later task cannot re-derive a limit from the scale worry Q4
  was filed over. §6's LV.13 row is marked landed and carries the one number the
  task had to *choose* rather than convert — the full-bleed margin is pinned to
  the shell's real gutter, not to 36 × 0.8 in the abstract. No scope, dependency
  or other decision changed.

- **v5.2 (2026-08-11)** — **LV.13's row now carries the `ComparisonPending`
  deletion** (LV.12 review, **R209**). The obligation already existed in four
  places — §6's erratum block, the v5.1 entry below, `PROGRESS-lists-v2.md`
  §2b's LV.13 bullet, and the JSDoc at `lists-page-v2.tsx:658` — but **not in
  the §6 row itself**, which `ACTIVE-BUILD.md` names as the task text a Builder
  reads. An obligation that lives everywhere except the line the next Builder is
  pointed at is an obligation that gets missed. Editorial: no scope, dependency
  or decision changed.

- **v5.1 (2026-08-11)** — **LV.12, the picker, landed — and its task row
  carried a clause the design package contradicts.** §6 gains the erratum in
  full; the short version is that *"honours the My lists / Saved tab"* is not
  what the prototype does (`ListsScreen.jsx:431` concatenates own + saved,
  `:49` hides the tab control in this mode) and not what
  `screens/side-by-side-picker.png` shows (9 cards = 7 own + 2 saved). The
  clause had no D-entry behind it, and every deliberate deviation from the
  handoff in this plan has one — so it was an error, not a ruling, and the
  **LV.4 precedent applies**: a Builder that finds a plan clause factually wrong
  against the design package folds an erratum and ships to LAW rather than
  burning a cycle on a halt.

  Two things the task text did not predict:

  1. **The clause was a trap, not a simplification.** Because the tab control
     does not render in compare mode, filtering by it would leave a viewer with
     no way to reach the other set — a viewer on *My lists* could never compare
     a saved board. It is now pinned by a test that was **shown failing** when
     the filter was reinstated, then reverted.
  2. **The picker's CTA needed somewhere to go.** LV.13 owns the columns, so
     LV.12 holds `compareIds` in `lists-page-v2.tsx` (where LV.13's header
     `Change lists` can also read it) and renders a temporary
     `ComparisonPending` panel behind it. Committing a comparison that changed
     nothing on screen would have been the "nothing happened means it worked"
     shape CLAUDE.md names. LV.13 deletes that function.

- **v5.0 (2026-08-11)** — **Round 2 opened** on Chris's *"round 2, go"*. §6
  gains the six-task breakdown (**LV.12 – LV.17**), and §3 gains two decisions.

  **D12 settles the one place the design package contradicts a Chris ruling.**
  The handoff's Interactions table, its store's `toggleDrafted` (global), and
  `side-by-side-columns.png` all show one tick striking a player in *every*
  list containing him. Chris ruled the opposite on 2026-08-10 — *"per user, per
  list… players will have multiple lists for multiple leagues"* — and that is
  the schema that shipped at LV.1.2. The screens README already anticipated
  this exact collision: **screenshots outrank the prose, they do not outrank
  Chris.** The reconciliation is that **the comparison set is the draft**: a
  tick writes one row per list *in the comparison*, which is every column on
  screen — so the picker's promise (*"every column updates"*) holds literally —
  and nothing outside it. No new table, column or route; the budget stays at
  three.

  **D13** points the pop-out store at the precedent
  `player-windows-store.ts` already set (geometry persisted, open windows not)
  rather than a second convention, and makes the app-shell host's
  render-nothing-when-empty a **test** rather than an intention — it is the one
  Round 2 file that mounts on every route in the app.

  Round 2 also inherits D11 explicitly: both screens compose `list-buckets.ts`,
  `list-row-parts.tsx`, `cover-tile.tsx`, `use-draft-mode.ts` and
  `use-list-drag.tsx` rather than growing a third tree. Reimplementing a solved
  behaviour on a new surface is the failure this build has already paid for.

- **v4.3 (2026-08-11)** — **LV.7, the cutover, and the ruling that changed what
  a "rebuild" task is allowed to lose (D11).**

  **D11 — a rebuilt surface owes a capability diff, and the diff is the
  deliverable.** LV.7 halted before deleting anything and produced one; Chris
  ruled *"Right rail dragging is a MUST. Yes mini player card 100%, MUST. Just
  use the one that's already there… Folders yes keep folders. Pin and Unpin
  great keep it"* — reversing the Builder's own recommendation on every item —
  and added the reason: *"This is why I didn't want to rebuild from scratch, I
  didn't think this was necessary."*

  That is a correction to method, and it is already CLAUDE.md's rule
  (*"Re-skin in place… Do not generate a replacement component library or
  parallel component tree"*). `lists/v2/**` was built as a parallel tree, and a
  parallel tree loses behaviour **by default**: none of the four losses would
  have failed a test, a type-check or a screenshot review. They would simply
  have stopped existing. So:

  1. **Port, do not reimplement.** Each ruled item was mounted from the thing
     that already worked — one `useDroppable` for the rail drag (with **no**
     edit to `app-dnd-context.tsx`, which already parsed the id), the existing
     `player-windows-store` for the mini card, the existing `use-folders.ts` and
     `folder-form-dialog.tsx` for folders, the existing `useToggleFavorite` for
     pin/unpin.
  2. **A deletion PR states what it deletes, in tests.** `lists-v2-flag.test.ts`
     pinned a branch that no longer exists, so it was replaced rather than
     edited: `lists/lists-cutover.test.ts` asserts the retired files are *gone*,
     that no branch on the removed flag survives, that every Lists URL still
     resolves, and that each of the four ported capabilities is mounted.
  3. **D3 is unchanged, and D4's `org` gains exactly one server write.** The
     retired *List order / Tiers* control was the last writer of
     `ranking_mode = 'rank_and_tier'` anywhere in the codebase, so the grouping
     control inherited that one write — Tier → `rank_and_tier`, Rank → `ranked`
     **only** when flipping tiers back off. The display store still writes
     nothing; this is the route call its own header always said would sit
     alongside `setOrg`. Without it no list could ever have been tiered again,
     while the create dialog went on promising *"Flip on the tiers view any
     time."*
  4. **`/app/lists/[listId]` is a redirect, not a second detail screen** —
     `redirect('/app/lists?list=<id>')` from a server component, with the
     selection pinned so a list that is neither owned nor saved is not bounced.
     Rendering the panel standalone would have needed its own page shell, which
     is the two-Lists-pages state the cutover exists to end. The old
     `/app/lists/draft-mode` redirects too rather than 404ing: the app itself
     sent people to that URL.

  The schema budget is **untouched and still closed at three** — LV.7 shipped no
  migration, no schema change and no new API route.

- **v4.2 (2026-08-11)** — **The public share view is rebuilt, and D7 grows from
  one sentence into five rules (LV.6).** The original decision said only that
  `/u/[username]/lists/[slug]` stays server-rendered. That is true and was not
  enough: the handoff defines **no** share screen, so a Builder arriving at this
  task has to invent one, and inventing one is exactly what the redesign rules
  warn against.

  D7 now says what to derive it *from*. The share view is the signed-in open
  list **minus what a stranger cannot do**, mounting the same components rather
  than a fork of them, split on one line — **display stays, writes go**. Session
  display state (D3) is not a privilege, so grouping, view style, `Stats` and
  the budget survive for a reader; every control that writes does not.

  Three things the build found that the plan had not priced:

  1. **`canEdit` was doing two jobs.** A drafted mark is per *viewer*
     (`list_player_drafted.user_id`, D2), not per owner, so "may edit this list"
     and "has an account at all" are different questions. `RowHandlers.canMark`
     is the second one. Collapsing them offers a signed-out viewer a checkbox
     that 401s.
  2. **Optional handlers, not no-op handlers.** Every write gesture on
     `ListBody`, `ListDetailsTab` and `ListToolbar` is optional now, and every
     affordance needs its flag *and* its handler. A deliberate break flipping
     both flags to `true` made 10 row menus appear for a signed-out stranger —
     and `Add players` and the bucket `Add +` stayed gone, because they need
     the handler as well. That is the double lock working, and it is the reason
     `() => {}` is not allowed here.
  3. **The LV.1.5 500 was reproduced on the live route.** v4.1 recorded that
     widening the tier CHECK *would have* crashed this page. LV.6 put the old
     `Map` shape back for one run against a public list holding `r1`/`c1` and
     got `HTTP 500 — Cannot read properties of undefined (reading 'push')`,
     then reverted to a 200. D7 now states the property that makes this page
     different: it 500s where every other surface degrades.

- **v4.1 (2026-08-11)** — **The tier CHECK is widened; the second schema
  exception is spent (LV.1.5).** Migration `081_list_players_tier_vocabulary.sql`
  replaces 003's `tier IN ('S',…,'F')` with the §3 Q2 vocabulary. D4's erratum
  is discharged: rounds are stored *and* assignable, and D4's round-mode note
  is corrected from "up to 16 rounds" to 30, which is what the ceiling actually
  is.

  Three things worth carrying forward, none of which the task text predicted:

  1. **Widening the column would have 500'd the public share view.**
     `PublicTierView` seeded its `Map` with S–F and then did
     `grouped.get(key)!.push(p)` — `undefined.push` on the first round-bucketed
     player, on a **server-rendered, SEO-critical** page (D7). The legacy detail
     view had the same shape in three places. Both are now keyed through
     `isTierKey`. Shown crashing in the browser and shown fixed.
  2. **The colour maps became functions.** `TIER_BG` / `TIER_BAND_BG` were total
     over `ListTier` and `undefined` for everything else; `cn(undefined)` is
     silent. They live in `bucket-colors.ts` now, total over `string` with a
     named fallback — and in a `.ts` file rather than a `.tsx` one, because
     `jsx: "preserve"` makes any `.tsx` module unimportable under vitest, which
     is why the old maps had no test at all.
  3. **The two layers are pinned to each other, not merely both edited.**
     `bucket-keys.test.ts` reads the migration off disk and asserts Zod and the
     CHECK regex agree over an exhaustive scan. Widening one alone goes red.

- **v4.0 (2026-08-11)** — **Single-select filter rows join the tab control, for
  now (new D10, new LV.11).** Chris, answering the question LV.9 raised and
  refused to improvise around: *"Use the tab component for now, we can create
  one for filters later."*

  The ruling is narrower than it sounds, and the narrowing is the whole task.
  **A segment asserts exactly one item is active**, so only genuinely
  one-of-many rows moved. Multi-select rows, and single-select rows where the
  user can clear back to nothing, stayed on `FilterChip` — converting those
  would have been a behaviour regression dressed as a restyle, and two of the
  ten surveyed sites were exactly that. D9's "out of scope" paragraph is
  amended in place rather than deleted, because its *reasoning* still holds for
  everything that did not move.

  Recorded as temporary in three places on purpose — this plan, `ui/tabs.tsx`'s
  header (which lists the rows that borrowed the control) and `ui/badge.tsx`'s
  (which lists the rows that must never be folded in). A test asserts all three
  still say so.

- **v3.9 (2026-08-11)** — **One control for every tab and segment (new D9,
  new LV.9).** Chris: *"Right now I see like 3 or 4 different versions of tabs.
  Let's use just that one."* He was counting accurately — the app carried the
  Radix primitive's ink-filled boxed tabs, four hand-rolled controls in
  `lists/v2`, a fifth in `player-detail-panels.tsx`, and `week-tabs.tsx`, which
  is off limits.

  Two things D9 settles that were not obvious going in. **Radix stays wherever
  the usage is a real tab set** — the ruling is about the look, and a
  `tabpanel` association with arrow-key navigation is not a look. And the
  Lists page header **cannot** be a Radix tab set even though it reads like
  one, because `PageHeader` pushes it into the app shell through a store, so
  no root can enclose both the control and its content.

  Also recorded here because it is a second instance of the §7 gap-4 lesson:
  the handoff's prose says chip tabs go *accent text* on select, and
  `screens/list-rail-list-view.png` fills them. **The screenshot wins**, and
  the styleguide's caption had already been describing the filled version
  while the primitive rendered ink.

- **v3.8 (2026-08-11)** — **D4 erratum, folded back from LV.4.** "Nothing is
  computed, and drag-to-bucket assigns in every mode — it is the same write in
  all four" was false for Avg cost and Budget %, whose membership is derived
  from `players.auction_value`; `screens/README.md` recorded half of this on
  2026-08-10 and LV.3 shipped against it. D4 now carries the four-row table and
  the consequence LV.4 took: those two groupings do not offer the drag, and say
  why. No product decision — this is the plan catching up with a screenshot and
  a shipped screen.

- **v3.7 (2026-08-11)** — **The third and final schema exception: `list_links`.**
  Chris: *"lets create the table for storing the link, we need a way to link
  back to resources used and a way for creators to attached videos to their
  lists."* Two purposes — **attribution** and a **creator video** — recorded in
  the new **D8**.

  This closes the gap v3.5 opened and LV.3 could only name: §2.2 had already
  put `links[]` back in scope from the screenshots (2026-08-10), but there was
  nowhere to store one, so the LV.3 builder shipped the section with its action
  **disabled** and flagged it as needing a ruling rather than building a dialog
  that would throw the link away on submit. That was the right call, and this
  is the ruling it asked for.

  The header, §1, §2.2, D6 and §5 DoD item 3 all move from **two** exceptions
  to **three**, and §4 gains a Phase 5 with **LV.8**. The budget is now stated
  as **closed at three** in both the header and D6 — the previous wording
  ("these two are the whole budget") had to be edited twice, so it is now
  written as a rule with a stop condition rather than a count.

  Two things D8 fixes in place rather than leaving for a reviewer to find: the
  **no-scraping rule** is restated at the decision level (labels are typed, not
  fetched — CLAUDE.md), and **`duplicate_list` does not copy links**, recorded
  deliberately so it is a known scope boundary and not a rediscovered bug.

- **v3.6 (2026-08-10)** — **Chris settles the drafted interaction, and it
  dissolves a whole bug class.** There is no draft-mode gate: the checkbox is
  permanent on any list and drafted is a visual treatment (the handoff already
  said so — the v1 toggle was never in the design). A *view* control therefore
  must never delete, so the legacy toggle-off no longer calls `clearDrafted()`
  — the single gesture R190/R195/R199/R203 all orbited. And the 3-state board
  cycle (`use-board-marks.ts`) is **deleted**, not preserved, which amends the
  boards-off-limits rule for that one file. D2 and §1 updated.

- **v3.5 (2026-08-09)** — **Erratum + ruling.** D4 claimed widening the tier
  vocabulary was "not a schema change" because the column is `text`. That was
  **false**: `list_players.tier` carries a live CHECK constraint from
  `003_lists.sql` restricting it to S–F, on local and production alike, so the
  Zod enum was never the binding gate. Found by the LV.1.5 Builder, which
  correctly HALTED rather than shipping a widening that would have 500'd.
  Chris ruled: **widen the CHECK** — the build's second and final schema
  exception. §1, D4 and D6 updated.

- **v3.4 (2026-08-09)** — **§2's persisted-store list corrected: seven, not
  six** (Reviewer R184, PR #109). `ui-store` was missing. The count is not
  decorative — D3's whole force is "every other store in `src/stores/` persists
  and this one deliberately does not", so an undercount weakens the argument
  the LV.1.4 store header makes to the next reader, which is exactly what
  happened: that header inherited the list verbatim. §2 now says how to check
  it (`grep -ln "persist(" src/stores/*.ts`). **Factual correction — no
  product decision.**

  Also recorded here because it was found in the same review: **`budget` has
  no consumer under D4** (R185). §2.2 keeps `budget` as session state per D3,
  but D4 deletes per-player `cost` — and share-of-budget is the only thing the
  prototype ever computes from `budget` (`lists.js:440-455`). Nothing in Round
  1 can render it, and the prototype's budget bands (`b1`–`b4`) have no
  defaults on our side, so a budget grouping would render raw keys. This is a
  **plan-level tension, not a build error**; it is flagged on the LV.3.3 /
  LV.3.5 checklist rows in `PROGRESS-lists-v2.md` §2 rather than resolved here,
  because resolving it is a product call about whether budget mode ships at
  all.

- **v3.3 (2026-08-09)** — **D1 reconciled with §4, editorially** (Reviewer
  R168, PR #107). v3.2's D1 said "New Lists replaces the bodies of existing
  components behind the flag", which the plan's own task list contradicts:
  LV.1.1 mandates a **route-level** branch (two component trees per route by
  construction, not a body swap), and LV.4.4 says "retire the old components",
  which only makes sense if they survive as separate files. D1 now states that
  the Lists v2 screens live in `src/components/lists/v2/`, are swapped in at
  the route branch, and are retired at LV.4.4 — with **"no forks of
  `src/components/ui/` primitives"** kept as the surviving, absolute
  prohibition. LV.1.1 shipped this structure and set the precedent for the
  remaining twelve tasks; recording it here means no future Builder has to
  re-derive it from a PROGRESS note. **No product decision, no scope change.**

- **v3.2 (2026-08-09)** — Chris: `drafted` is **per user, per list** — the
  handoff's global rule is overridden, because one player is taken in one
  league's draft and not another's. Recorded as the plan's only deliberate
  deviation from the design LAW. Also capped in scope to a display treatment:
  *"nothing more than telling the UI to display that player differently in
  that list."* Table becomes `list_player_drafted (user_id, list_id,
  player_id)`; the season column is dropped, since per-list scoping already
  separates one draft from the next. `use-draft-mode.ts` turns out to be
  per-list already, so LV.1.3 changes storage and nothing else.

- **v3.1 (2026-08-09)** — Chris, two boundaries. **Lists persist forever;
  boards are season-bound** — so `season` scopes the drafted marks and never
  the list, and no season column goes near `lists`. And **boards are off
  limits entirely**: Round 1 rewires `use-draft-mode.ts` alone, leaving
  `board-labels-store` and `use-board-marks` unopened. v3.0 had all three
  consolidating, which would have put a flag-gated surface's regression risk
  on the launch path.

- **v3.0 (2026-08-09)** — Chris reversed the trade-off recommendation, and the
  reversal is the point. **`drafted` persists server-side** (one new table,
  season-scoped, cross-device) because seeing who is gone from your phone is
  the feature. **Display prefs deliberately do not persist** — "just
  customizations that don't need to save, like search filters" — so they are
  now a decision to defend, not a limitation to apologise for. Adds a migration task
  (LV.1.2) and re-opens what clears `drafted`, which localStorage
  had been answering for free: season scoping plus a manual clear.

- **v2.3 (2026-08-09)** — Chris: list visibility is **private or public only**;
  the handoff's third "link" state is not wanted. Recorded as the intended
  design rather than a UI-only compromise, and removed from the trade-off
  list. Two trade-offs remain, both about per-browser state.

- **v2.2 (2026-08-09)** — Chris: tier labels stay **S/A/B/C/D/F**; no numeric
  migration of the tier scale. LV.1.4 narrows accordingly — it now exists only
  so round grouping can exceed six buckets (a draft runs 12–16 rounds against
  a six-value enum), with S–F still valid.
- **v2.1 (2026-08-09)** — Chris's correction: tier, round, cost and budget are
  **one mechanism with four label sets**, not separate or computed fields
  (D4). Removes the "computed grouping" design and the read-only-cost-band
  trade-off; grouping is a stored bucket, so it follows a shared list. Adds
  LV.1.4 for the tier route's legacy S–F enum. Also confirms `drafted` needs
  no table — v2.0 had already moved it to the existing global store.
- **v2.0 (2026-08-09)** — UI/UX-only ruling. Migration phase removed; gaps
  re-closed via client state, computation, or reduced scope (§2.2). Found
  `drafted` already implemented three ways (§2.1), which resolves v1.0 Q1.
- **v1.0 (2026-08-09)** — initial plan; assumed a schema migration gated the
  build. Superseded.
