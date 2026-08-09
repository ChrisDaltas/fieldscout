# Delivery Plan: Lists v2

> **v3.0 — 2026-08-09. UI/UX only, with exactly one data exception.**
>
> Everything the handoff needs that has no home in the current schema is
> **client-side state**, **relabelled onto an existing field**, or **dropped
> from scope** — with a single deliberate exception: **`drafted` persists
> server-side** (Chris, 2026-08-09), because seeing who is already gone from
> your phone is the point of the feature. That exception buys one new table
> and nothing else — no changes to `lists` or `list_players`.
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
| **UI/UX only, one exception** | No schema changes except the `drafted` table (D2/LV.1.2). See §2.2. |
| **Display prefs don't persist** | View style, stat columns, band labels, budget are session customizations — like search filters. Not saved, by decision, not by constraint. |
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
  `createJSONStorage(localStorage)` in `ai-build-store`, `list-order-store`,
  `history-store`, `rail-store`, `board-labels-store`, `player-windows-store`.
- **Stat columns are a fixed 7-option chip picker** (`customize-popover.tsx`,
  102 lines: proj, current, last, adp, sos, auction, bye) with **no
  persistence at all**. The handoff wants a searchable, grouped, reorderable
  catalog — a rebuild, but one that can only improve on "not saved anywhere".

### 2.1 `drafted` already exists — three times

The handoff's headline store rule ("`drafted` is global — toggling it marks
that player in *every* list containing him") is **already 80% built**, just
inconsistently:

| Implementation | Scope | Storage |
| --- | --- | --- |
| `src/hooks/use-draft-mode.ts` | **per list** — `fieldscout.drafted.${listId}` | localStorage |
| `src/stores/board-labels-store.ts` | **per player, global** — `'drafted' \| 'dnd'` | Zustand + localStorage |
| `src/components/lists/draft-mode/use-board-marks.ts` | per *set* of lists, 3-state cycle | localStorage |

`board-labels-store` is already the right *shape* — global, keyed by
`playerId` — it is simply wired only to Big Board, and stores locally.

**Storage is what changes** (D2): all three point at one server-side source so
marks follow you between devices. The shape work is largely done; the
persistence work is new.

Note what this costs. `board-labels-store`'s own comment argues the local
behavior is *correct* — labels reset with the browser, *"which matches how a
draft board actually gets used season to season."* Moving server-side throws
that away, which is why D2 adds season scoping to get it back deliberately.

### 2.2 Closing the data-model gap

| Handoff need | How it is met | Cost |
| --- | --- | --- |
| `entries[].drafted` (global) | **Server-side** — one new table, cross-device (D2/LV.1.2) | the one exception |
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
| `scope`, `links[]` | **Dropped** — the handoff defines them but never renders them | dropped |

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
4. **`drafted` travels too** — server-side, per user, across every list and
   every device (D2). This is the one thing that had to leave UI-only, and the
   reason is concrete: a draft board that forgets who is gone the moment you
   pick up your phone is not a draft board.

---

## 3. Design decisions

- **D1 — Re-skin in place, per CLAUDE.md.** No parallel component tree. New
  Lists replaces the bodies of existing components behind the flag; shared
  primitives in `src/components/ui/` get CVA variants, never forks.

- **D2 — `drafted` is server-side, per user, global across lists**
  (Chris, 2026-08-09). One new table, the plan's only schema change:

  ```
  user_drafted_players (user_id, player_id, season, drafted_at)
    primary key (user_id, player_id, season)
    RLS: every operation requires auth.uid() = user_id
  ```

  Nothing on `lists` or `list_players` changes. The three client
  implementations in §2.1 collapse onto this one source of truth; Big Board and
  draft-mode must keep working — verify both, they are the regression risk.

  **`season` exists because server persistence re-opens a question that
  localStorage answered for free.** When marks lived in the browser they
  cleared themselves, and `board-labels-store`'s own comment called that
  correct: *"labels reset with the browser, which matches how a draft board
  actually gets used season to season."* Persist them server-side and next
  August your board still shows last year's draft. Scoping rows by season
  makes each season start empty on its own, and costs one column.

  A manual **"Clear drafted"** in the list options menu ships alongside it —
  season scoping handles next year, the button handles a mistake tonight.

  Reads filter to `CURRENT_SEASON` (`src/lib/stats/aggregate-fantasy`).

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

  **Round mode still needs more bucket keys than the enum allows.** That
  route validates `z.enum(['S','A','B','C','D','F'])` — six values. A fantasy
  draft runs 12–16 rounds, so round grouping cannot represent a real draft
  against a six-value enum. LV.1.5 widens it to accept round/band keys as
  well; S–F stays valid so nothing existing breaks. The column is already
  `text`, so this is a validation change on an existing route — **not** a
  schema change, and inside UI-only scope. It stays its own task rather than
  being smuggled into a screen PR.

  Note the color ramp has 6–7 hues against up to 16 rounds, so round mode
  cycles colors rather than assigning a unique one per bucket.

  Consequence: because buckets live server-side, grouping **does** follow a
  shared list. Only the label set is local.

- **D5 — Drag-and-drop uses the handoff's gap model** and measures with
  `offsetHeight`/`offsetWidth`. State updates only when the target slot
  changes — updating per `dragover` visibly janks.

- **D6 — Two server-side changes in Round 1, both named.** (a) the `drafted`
  table and its route (D2/LV.1.2); (b) widening one Zod enum (D4/LV.1.5).
  Existing routes cover every other mutation. A task that believes it needs
  more has crossed out of scope — stop and raise it, do not proceed.

- **D7 — The public share view stays server-rendered.**
  `/u/[username]/lists/[slug]` is SEO-critical per CLAUDE.md.

---

## 4. Task breakdown (dependency order)

One task = one Builder session = one PR. `/build-next` drives.

**Phase 1 — foundations**

| id | task | depends on |
| --- | --- | --- |
| LV.1.1 | `featureFlags.listsV2` + route-level branch so old and new Lists coexist | — |
| LV.1.2 | **Migration**: `user_drafted_players` (+ season scoping, RLS, indexes) and its read/toggle route (D2). Satisfies checklists §8.1–8.2; reaches production via `npx supabase db push`, never by hand | — |
| LV.1.3 | Point all three client `drafted` implementations at the new server source (D2); Big Board and draft-mode stay green — verify both | LV.1.2 |
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
| LV.4.4 | Flag flip + retire the old components | all |

---

## 5. Definition of Done (per task)

1. `npm run type-check` and `npm run lint` clean — **shown, not claimed**.
2. `npm run test:unit` green. `share-link-permanence.test.ts` stays green.
3. **No migration, no schema change, no new API route** outside the two named
   in D6 (LV.1.2's `drafted` table + route, LV.1.5's enum). A task that thinks
   it needs more has left scope: raise it, do not proceed.
   LV.1.2 additionally satisfies checklists §8.1–8.2 (RLS, indexes,
   `IF NOT EXISTS`, banner comment citing the handoff) and reaches production
   via `npx supabase db push` — **never** by hand (CLAUDE.md migration
   discipline).
4. Verified in the browser preview with a screenshot at desktop **and** mobile.
5. `PROGRESS-lists-v2.md` updated.
6. Small commit citing the handoff section; branch + PR, never direct to main.

---

## 6. Round 2 (deferred)

Side-by-side compare, and pop-out windows. Both stay UI-only:
`player-windows-store.ts` already models floating windows with positions
persisted across reloads and back-to-front z-ordering, which is most of the
pop-out infrastructure. Pop-outs are hosted by the **app shell** so they
survive navigation — the only part of this package that can destabilize
surfaces outside Lists, which is why it is off the launch path.

---

## 7. Open questions for Chris

*(Q1 — Round 1 scope — is resolved: page + detail first, then side-by-side and
pop-outs. Ruled by Chris 2026-08-09.)*
- **Q2 — Confirm `drafted` is global, not per-list.** Marking Bijan drafted
  removes him from *every* list you own, on every device — which is what the
  handoff specifies and what "see who was drafted from my phone" implies.
  Flagged explicitly because an earlier draft of this plan got a correction on
  exactly this point; if drafted should instead be per-list, say so before
  LV.1.2 — it changes the table's primary key.

*(v2.x's trade-off questions are resolved: display prefs deliberately do not
persist; `drafted` does, server-side.)*

*(v1.0's Q1 — "what clears `drafted`" — is resolved, but not the way v2.0
resolved it. Server persistence means the browser no longer clears anything:
season scoping starts each year empty, and a manual "Clear drafted" handles
tonight's mistakes. See D2.)*

## Changelog

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
