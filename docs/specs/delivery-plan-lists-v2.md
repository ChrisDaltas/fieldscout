# Delivery Plan: Lists v2

> **v3.7 — 2026-08-11. UI/UX only, with exactly three data exceptions.**
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
| **Flag** | All of it behind `featureFlags.listsV2`. On in local dev, off deployed, until Chris flips it. The current Lists page serves production throughout. |
| **Free-only** | No `is_pro` gates. |
| **Round 1 scope** | Lists page + list detail. Side-by-side compare and pop-out windows are **Round 2** (§6). *(Ruled by Chris, 2026-08-09.)* |

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
  `cost` field, nothing is computed, and drag-to-bucket assigns in every mode
  — it is the same write in all four.

  Storage is the existing `list_players.tier` (`text`), written through the
  existing `PATCH /api/lists/[id]/players/[playerId]/tier` route.

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

  A DB CHECK is also the strongest available guard on what a bucket key may be:
  it covers `duplicate_list`, which copies `tier` verbatim and never passes
  through the API's validation.

  Note the color ramp has 6–7 hues against up to 16 rounds, so round mode
  cycles colors rather than assigning a unique one per bucket.

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
| LV.1.5 | Widen the tier route's Zod enum so round/band buckets beyond six are accepted (D4). **S–F stays valid** — tier labels are unchanged | — |

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
| LV.4.3 | Public share view in the new language, still server-rendered (D7) | LV.3.* |
| LV.4.4 | Flag flip + retire the old components — including **deleting `use-board-marks.ts` and the old `/app/lists/draft-mode` 3-state cycle** (D2; §1's boards amendment scopes this), and correcting that file's now-false header comment (R192) | all |

**Phase 5 — attached links** *(added v3.7, ruled 2026-08-11)*

| id | task | depends on |
| --- | --- | --- |
| LV.8 | **Migration `080_list_links.sql`** + RLS + indexes, the `/api/lists/[id]/links` routes (add, remove, reorder), and the Details tab wired to them (D8). Satisfies checklists §8.1–8.2; reaches production via `npx supabase db push`, never by hand | LV.3 |

---

## 5. Definition of Done (per task)

1. `npm run type-check` and `npm run lint` clean — **shown, not claimed**.
2. `npm run test:unit` green. `share-link-permanence.test.ts` stays green.
3. **No migration, no schema change, no new API route** outside the three named
   in D6 (LV.1.2's `drafted` table + route, LV.1.5's enum, LV.8's `list_links`
   table + routes). A task that thinks it needs more has left scope: raise it,
   do not proceed.
   LV.1.2 and LV.8 additionally satisfy checklists §8.1–8.2 (RLS, indexes,
   `IF NOT EXISTS`, banner comment citing the ruling) and reach production
   via `npx supabase db push` — **never** by hand (CLAUDE.md migration
   discipline).
4. Verified in the browser preview with a screenshot at desktop **and** mobile.
5. `PROGRESS-lists-v2.md` updated.
6. Small commit citing the handoff section; branch + PR, never direct to main.

---

## 6. Round 2 (deferred)

Side-by-side compare, and pop-out windows. **The new side-by-side is where
draft night actually happens** — its rows carry a permanent drafted checkbox
(handoff §"Side by side"), so it writes real account-persisted marks rather
than the browser-only tap-cycle the old board used. Both stay UI-only:
`player-windows-store.ts` already models floating windows with positions
persisted across reloads and back-to-front z-ordering, which is most of the
pop-out infrastructure. Pop-outs are hosted by the **app shell** so they
survive navigation — the only part of this package that can destabilize
surfaces outside Lists, which is why it is off the launch path.

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
