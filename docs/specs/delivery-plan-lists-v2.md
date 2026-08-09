# Delivery Plan: Lists v2

> **v2.3 — 2026-08-09. UI/UX ONLY (Chris, 2026-08-09).** No migrations, no
> schema changes, no new tables, no RLS work. Anything the handoff needs that
> has no home in the current schema is either **client-side state**,
> **computed**, or **dropped from scope** — never a new column. This is a
> restyle-and-rebuild of the Lists surface, not a data feature.
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
| **UI/UX only** | No schema changes. See §2.2 for how each gap is closed without one. |
| **Scale** | The app's ×0.8 tokens **stay**. Convert the handoff's 1× numbers down: a stated 32px control is `h-btn-sm` (26); a stated 1.25px border is `border-1`. Re-tokenizing is post-launch. |
| **Color** | Implement from **tokens, never the handoff's literal hex**. The prototype is token-driven (19 × `var(--accent)`, zero hardcoded blues); its `#1F6BF0` describes what that token resolved to in *their* bundle. The app's `accent` is `#3d5cff`. |
| **Flag** | All of it behind `featureFlags.listsV2`. On in local dev, off deployed, until Chris flips it. The current Lists page serves production throughout. |
| **Free-only** | No `is_pro` gates. |
| **Round 1 scope** | Lists page + list detail. Side-by-side compare and pop-out windows are **Round 2** (§6). *(Assumption — flip it before LV.1.1 if wrong.)* |

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
  `trash`, `restore`, `generate` (AI). **Round 1 adds no API routes.**
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

`board-labels-store` is already the shape the handoff wants — global, keyed by
`playerId` — and its own comment already reasons the way the handoff does:
labels reset with the browser, *"which matches how a draft board actually gets
used season to season."* It is simply wired only to Big Board today.

**So the work is consolidation, not construction** (D2), and it answers the
open question from v1.0 about what clears `drafted`: the browser does, by
existing precedent.

### 2.2 Closing the data-model gap without schema changes

| Handoff need | How it is met | Cost |
| --- | --- | --- |
| `entries[].drafted` (global) | Unify onto the existing global player-keyed store (§2.1) | none — already built |
| `view` (list \| table \| card) | New persisted Zustand store, keyed by `listId` | small |
| `cols` (chosen stats, ordered) | Same store | small — today it persists nowhere |
| `costBands` labels, `budget` | Same store (precedent: `board-labels-store`) | small |
| `org` = tier \| round \| cost \| budget | **One mechanism** — the bucket is `list_players.tier`; `org` only swaps the label set (D4). Ranked = array order | none |
| editable cost-band labels | Client store (D3) | small |
| `tags` | `list_tags` + `tags` tables already exist | none |
| `fav` / `saved` | `is_favorites` + `list_favorites` already exist | none |
| `stats.views/likes` | `view_count` / `like_count` already exist | none |
| `cover.{color,emoji}` | Use existing `thumbnail_url` only — no color/emoji picker | **reduced** |
| `visibility` | **Private or public only** (Chris, 2026-08-09) — the handoff's third "link" state is not wanted. Existing `is_private` covers it exactly | none |
| `entries[].round` / `.cost` | Not separate fields — they are the same bucket as `tier`, relabelled (D4) | none |
| `scope`, `links[]` | **Dropped** — the handoff defines them but never renders them | dropped |

**Accepted trade-offs**, stated plainly so nobody rediscovers them mid-build:

1. Display preferences (`view`, `cols`, cost-band labels, `budget`) are
   **per-browser**. They do not follow a shared list to another viewer, and do
   not sync across devices. The handoff implies a shared list opens the way its
   author arranged it; that does not happen in Round 1.
2. `drafted` marks are **per-browser** and clear with site data.

**Visibility is not a trade-off** — private/public is the intended design
(Chris, 2026-08-09), not a reduction forced by UI-only. The handoff's "link"
state is simply not wanted; do not build toward it.

**Bucket membership is not on that list either** — it lives in
`list_players.tier` server-side, so which players sit in which tier/round/band
*does* follow a shared list. Only the label set and any custom band names are
local.

Both remaining trade-offs are **additively reversible.** Adding server
persistence later means reading from the server when present and falling back
to local — not a rewrite.

---

## 3. Design decisions

- **D1 — Re-skin in place, per CLAUDE.md.** No parallel component tree. New
  Lists replaces the bodies of existing components behind the flag; shared
  primitives in `src/components/ui/` get CVA variants, never forks.

- **D2 — One global drafted store.** Consolidate the three implementations in
  §2.1 onto a single player-keyed persisted store. `use-draft-mode.ts`
  (per-list) is the one whose *semantics* change — that is the handoff's
  intent, and it is the only behavioral change in this task. Big Board and
  draft-mode must keep working; verify both.

- **D3 — One `useListDisplayPrefs` store**, persisted, keyed by `listId`,
  holding `view`, `cols`, `costBands`, `budget`. One store, not four — these
  are always read together by the toolbar.

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
  against a six-value enum. LV.1.4 widens it to accept round/band keys as
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

- **D6 — No new API routes in Round 1**, and no schema changes. Existing
  routes cover every server-side mutation; the only server-side edit is
  widening one Zod enum (D4/LV.1.4). If a task believes it needs more, that is
  a signal it has crossed out of UI-only — stop and raise it.

- **D7 — The public share view stays server-rendered.**
  `/u/[username]/lists/[slug]` is SEO-critical per CLAUDE.md.

---

## 4. Task breakdown (dependency order)

One task = one Builder session = one PR. `/build-next` drives.

**Phase 1 — foundations**

| id | task | depends on |
| --- | --- | --- |
| LV.1.1 | `featureFlags.listsV2` + route-level branch so old and new Lists coexist | — |
| LV.1.2 | Consolidate `drafted` onto one global player-keyed store (D2); keep Big Board and draft-mode green | — |
| LV.1.3 | `useListDisplayPrefs` store — `view`, `cols`, `costBands`, `budget`, persisted per `listId` (D3) | — |
| LV.1.4 | Widen the tier route's Zod enum so round/band buckets beyond six are accepted (D4). **S–F stays valid** — tier labels are unchanged | — |

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
| LV.3.2 | Tabs (List/Details/Comments) + toolbar: bare-select grouping dropdown, view-style toggle, Stats, Add players | LV.3.1, LV.1.3 |
| LV.3.3 | View style: List — 60px rows, stat cells, computed `minWidth = 330 + cols·72`, section cards | LV.3.2 |
| LV.3.4 | View style: Table — 44px rows, sticky header | LV.3.2 |
| LV.3.5 | View style: Cards — corner cells, stat strip, first-three-stats rule, 62px label rail for grouped lists (none when simply ranked) | LV.3.2 |
| LV.3.6 | Drag-and-drop across all three views (D5); drag onto a section header assigns that bucket — same write in all four grouping modes (D4) | LV.3.3–3.5, LV.1.4 |
| LV.3.7 | Stats picker modal — grouped catalog ordered by this list's coverage, search, reorderable chips | LV.3.2 |
| LV.3.8 | Notes: accent `comments` mark, body-portalled hover card clamped to the viewport | LV.3.3 |
| LV.3.9 | Drafted checkbox wired to the global store (D2) + "Clear drafted" in the options menu | LV.1.2, LV.3.3 |

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
3. **No migration, no schema change, no new API route** — the sole exception
   is LV.1.4's Zod enum widening. A task that thinks it needs more has left
   scope: raise it, do not proceed (D6).
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

- **Q1 — Round 1 scope**: confirm §1's assumption (page + detail first).
- **Q2 — Accepted trade-offs**: §2.2 lists two (per-browser display prefs,
  per-browser drafted marks). Both follow from UI-only; either one you reject
  becomes a schema change. *(Visibility is resolved — private/public is the
  design, not a compromise.)*

*(v1.0's Q1 — "what clears `drafted`" — is resolved: the browser does, per the
existing `board-labels-store` precedent.)*

## Changelog

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
