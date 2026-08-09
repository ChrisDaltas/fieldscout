# Delivery Plan: Lists v2

> **v1.0 — 2026-08-09.** Ships **ahead of M2 leagues**, on its own track
> (Chris, 2026-08-09). M2 pauses at L.B3.1 until this is out.
>
> **Design LAW is `docs/design/lists/README.md`** — the committed Claude Design
> handoff, with the prototype source alongside it in `docs/design/lists/design/`.
> This plan never overrides it. Where the handoff is silent (loading, empty,
> error, overflow states), extend the new design language per CLAUDE.md.
>
> If the handoff seems wrong or ambiguous: **stop**, write the question and a
> recommendation into `PROGRESS-lists-v2.md` under "Design questions". Do not
> improvise around it.

---

## 1. Rulings in force

| Ruling | Detail |
| --- | --- |
| **Scale** | The app's ×0.8 pre-scaled tokens **stay**. Convert the handoff's 1× numbers down: a stated 32px control is `h-btn-sm` (26), a stated 1.25px border is `border-1`. Re-tokenizing is post-launch. |
| **Color** | Implement from **tokens, never the handoff's literal hex**. The prototype is token-driven (19 × `var(--accent)`, zero hardcoded blues); its `#1F6BF0` describes what that token resolved to in *their* bundle. The app's `accent` is `#3d5cff`. |
| **Flag** | All of it lands behind `featureFlags.listsV2`. On in local dev, off deployed, until Chris flips it. The current Lists page keeps serving production throughout. |
| **Free-only** | No `is_pro` gates. Nothing here is Pro-gated. |
| **Round 1 scope** | Lists page + list detail. Pop-out windows and side-by-side compare are **Round 2** — see §6. *(Assumption, not yet ruled — flip it before LV.1.1 starts if wrong.)* |

---

## 2. Current state (surveyed 2026-08-09, grep-verified)

- **Routes exist and are wired**: `src/app/app/lists/page.tsx` (48 lines),
  `src/app/app/lists/[listId]/page.tsx` (77), plus `new/` and `draft-mode/`.
  Public share route is `src/app/u/[username]/lists/[listSlug]/page.tsx`.
- **The UI weight is in two components**:
  `src/components/lists/list-detail-view.tsx` is **2,161 lines**;
  `lists-browse.tsx` is 328; `list-card.tsx` is 325. Round 1 roughly doubles
  this surface, which is why it is not one PR.
- **The API surface is broad and mostly reusable** — 20 route files under
  `src/app/api/lists/`, including `players/reorder`, `players/[playerId]/tier`,
  `players/[playerId]/slot`, `players/bulk`, `duplicate`, `favorite`,
  `comments`, `like`, `thumbnail`, `trash`, `restore`, `generate` (AI).
- **Share-link permanence is already correct and tested.** Renaming a list does
  not regenerate its slug; `src/app/api/lists/share-link-permanence.test.ts`
  guards it. **Do not touch slug generation.**
- **Stat columns are a fixed 7-option chip picker** (`customize-popover.tsx`,
  102 lines: proj, current, last, adp, sos, auction, bye) with no persistence.
  The handoff wants a searchable, grouped, reorderable catalog persisted per
  list — this is a rebuild, not an extension.
- **Existing tables**: `lists`, `list_players`, `list_tags`, `tags`,
  `list_comments`, `list_likes`, `list_favorites`, `list_folders`, plus RPCs
  `duplicate_list`, `reorder_list_players`, `notify_list_followers`.
  *(The `draft_*` tables are the leagues engine — unrelated to list "drafted".)*

### 2.1 Data-model gap

The handoff's `List` / `Entry` model against `lists` / `list_players` today:

| Handoff field | Status | Note |
| --- | --- | --- |
| `name` `desc` `created` `stats.views/likes` | ✅ | `title`, `description`, `created_at`, `view_count`, `like_count` |
| `author.handle` | ✅ | `owner_id` → `profiles.username` |
| `fav` (permanent Favorites) | ✅ | `is_favorites` |
| `saved` (saved from another user) | ✅ | `list_favorites` table |
| `tags` | ✅ | `list_tags` + `tags` |
| `entries[].note` | ✅ | `list_players.notes` |
| `entries[].tier` | ✅ | `list_players.tier` |
| `cover.{color,emoji}` | ⚠️ | only `thumbnail_url` — no color or emoji |
| `kind` (ranking \| list) | ⚠️ | inferable from `ranking_mode` / `is_big_board`; needs an explicit decision |
| `visibility` (private \| link \| public) | ⚠️ | `is_private` is 2-state — **the "link" state does not exist** |
| `org` (rank \| tier \| round \| cost \| budget) | ⚠️ | `ranking_mode` covers ranked/tiers/rank_and_tier/unranked — **round, cost, budget missing** |
| `view` (list \| table \| card) | ❌ | not persisted per list |
| `cols` (chosen stat ids, ordered) | ❌ | not persisted per list |
| `costBands` `budget` | ❌ | |
| `scope` (predraft \| week \| ros) | ❌ | |
| `links[]` (video/article) | ❌ | |
| `entries[].round` `entries[].cost` | ❌ | |
| **`entries[].drafted`** | ❌ | **and it is global** — see D2 |

**So this is not a UI-only job.** Round 1 needs one migration before any
screen work, which is why LV.1.1 is the gate.

---

## 3. Design decisions

- **D1 — Re-skin in place, per CLAUDE.md.** No parallel component tree. The
  new Lists surface replaces the bodies of the existing components behind the
  flag; shared primitives in `src/components/ui/` get CVA variants, never forks.

- **D2 — `drafted` is user-scoped, not list-scoped.** The handoff is explicit:
  toggling drafted marks the player in *every* list containing him. That is a
  per-user set of players, not a column on `list_players`. New table
  `user_drafted_players (user_id, player_id, drafted_at)` with RLS restricting
  every operation to `auth.uid() = user_id`.
  **Open question (Q1):** what clears it? A draft board full of last year's
  drafted players is worse than useless. Recommendation: a "Clear drafted"
  action in the list options menu, plus no automatic expiry in Round 1.

- **D3 — `org`, `view`, and `cols` are per-list display state, stored on
  `lists`.** `view` and `cols` are view preferences, but the handoff treats
  them as properties *of the list* (a shared list opens the way its author
  arranged it). Add `view text`, `cols jsonb`, `org text`, `budget int`,
  `cost_bands jsonb`, `scope text` to `lists`. `org` supersedes `ranking_mode`
  for new lists; **keep `ranking_mode` in place and backfill from it** — do not
  drop a column the old page still reads while it is serving production.

- **D4 — `visibility` gets a real 3-state column**, not another boolean.
  `visibility text check (visibility in ('private','link','public'))`,
  backfilled from `is_private`. `is_private` stays until the old page is gone.

- **D5 — Drag-and-drop uses the handoff's gap model**, and measures with
  `offsetHeight`/`offsetWidth`. The prototype's `getBoundingClientRect` caveat
  is a zoom artifact that does not apply at 1×, but offset\* is correct in both
  and the handoff's own note says so. State updates only when the target slot
  changes — updating per `dragover` visibly janks.

- **D6 — Reuse the existing API routes.** `players/reorder`,
  `players/[playerId]/tier`, `duplicate`, `favorite`, `comments`, `like` all
  survive. New routes only for genuinely new state (drafted, cost/round,
  display prefs).

- **D7 — Server-render the public share view.** `/u/[username]/lists/[slug]`
  is SEO-critical per CLAUDE.md and stays a Server Component.

---

## 4. Task breakdown (dependency order)

Each task = one Builder session = one PR, per CLAUDE.md. `/build-next` drives.

**Phase 1 — foundations (gates everything)**

| id | task | depends on |
| --- | --- | --- |
| LV.1.1 | Migration: `user_drafted_players`; `lists` gains `view`, `cols`, `org`, `budget`, `cost_bands`, `scope`, `visibility`; backfills from `ranking_mode` / `is_private`; RLS + indexes | — |
| LV.1.2 | `featureFlags.listsV2` + route-level branch so old and new Lists coexist | — |
| LV.1.3 | Typegen + re-append the hand-written alias block; API routes for drafted toggle and display prefs | LV.1.1 |

**Phase 2 — Lists page**

| id | task | depends on |
| --- | --- | --- |
| LV.2.1 | Page header: heading, view-mode segmented control, My lists / Saved tabs, New list. Hover/active states in CSS classes, **not inline styles** (handoff's critical note) | LV.1.2 |
| LV.2.2 | Rail mode — 200px sticky rail + shared edge, selected-row treatment | LV.2.1 |
| LV.2.3 | Cards mode — responsive gallery, flat rest / lift on hover | LV.2.1 |

**Phase 3 — list detail**

| id | task | depends on |
| --- | --- | --- |
| LV.3.1 | Hero: cover, inline rename (hover pencil, owner-only, Enter/Esc), byline, action cluster, options menu | LV.1.3 |
| LV.3.2 | Tabs (List/Details/Comments) + toolbar: grouping dropdown, view-style toggle, Stats, Add players | LV.3.1 |
| LV.3.3 | View style: List — 60px rows, stat cells, computed `minWidth`, section cards | LV.3.2 |
| LV.3.4 | View style: Table — 44px rows, sticky header | LV.3.2 |
| LV.3.5 | View style: Cards — corner cells, stat strip, first-three-stats rule, label rail for grouped lists | LV.3.2 |
| LV.3.6 | Drag-and-drop across all three views (D5) + bucket assignment | LV.3.3–3.5 |
| LV.3.7 | Stats picker modal — grouped catalog ordered by list coverage, search, reorderable chips | LV.3.2 |
| LV.3.8 | Notes: accent `comments` mark, body-portalled hover card clamped to viewport | LV.3.3 |
| LV.3.9 | Drafted checkbox wired to the global flag (D2) + "Clear drafted" | LV.1.3, LV.3.3 |

**Phase 4 — states and cutover**

| id | task | depends on |
| --- | --- | --- |
| LV.4.1 | Loading / empty / error / overflow states across both screens | LV.3.* |
| LV.4.2 | AI list generation + persona surfaces restyled into the new language (CLAUDE.md: never leave them in the old style, never remove them) | LV.3.* |
| LV.4.3 | Public share view `/u/[username]/lists/[slug]` in the new language, still server-rendered (D7) | LV.3.* |
| LV.4.4 | Flag flip + retire the old components | all |

---

## 5. Definition of Done (per task)

Mirrors delivery plan §2.3 for leagues:

1. `npm run type-check` and `npm run lint` clean — **shown, not claimed**.
2. `npm run test:unit` green. `share-link-permanence.test.ts` must stay green.
3. Migration tasks additionally satisfy checklists §8.1–8.2 (RLS, indexes,
   `IF NOT EXISTS`, banner comment, service-role policy where applicable).
4. Verified in the browser preview with a screenshot at desktop **and** mobile.
5. `PROGRESS-lists-v2.md` updated.
6. Small commit citing the handoff section; branch + PR, never direct to main.

---

## 6. Round 2 (deferred)

Side-by-side compare mode, and pop-out windows. Pop-outs are hosted by the
**app shell** so they survive navigation — the only part of this package that
can destabilize surfaces outside Lists, which is why it is not on the launch
path. Both are fully specified in the handoff; nothing needs re-deciding, only
re-sequencing.

---

## 7. Open questions for Chris

- **Q1 — What clears `drafted`?** (D2) Recommendation: manual "Clear drafted"
  in the options menu, no auto-expiry in Round 1.
- **Q2 — Round 1 scope** — confirm §1's assumption (page + detail first).
- **Q3 — `links[]` and `scope`** are in the handoff data model but never
  rendered in the screens it describes. Recommendation: skip both in Round 1,
  add when a screen actually needs them.

## Changelog

- **v1.0 (2026-08-09)** — initial plan. Survey grep-verified same day; scale
  and color rulings recorded from Chris 2026-08-09.
