# Delivery plan: Scout

**Spec (LAW):** `docs/specs/spec-scout.md` (v1.7)
**Progress/memory:** `docs/specs/PROGRESS-scout.md` — read at session start, update at session end
**Version:** v1.7

> Milestones keep **canonical order** (M0 → M1 → M2 → M3 → M4 → M5 → M6). No calendar
> deadlines. A milestone ships when its quality gate passes, not when a date arrives.

---

## 1. Shape of the work

Scout is sequenced so the **riskiest assumption is tested first and the cheapest value
ships first** — and those happen to be the same milestone.

M0 builds the metric registry and the rail explainer against **metrics FieldScout already has**
(target share and snap % from `player_usage`, plus the existing box-score columns).
That means:

- Real user-visible value ships before a single line of ETL is written.
- The registry → panel → page architecture is proven against live surfaces while it's still cheap to change.
- If the nflverse pipeline turns out harder than expected, M0 still stands on its own.

Everything after M0 is additive. There is no milestone whose failure invalidates a
prior one.

### 1.1 Dependency graph

```
                          PART A — in the product
                        ┌────────────────────────────┐
M0 registry + explainer ┼─> M1 pipeline ─┬─> M2 stat center
                        │                └─> M3 player profile
                        └────────────────────────────┘
                          PART B — the standalone guide
                        ┌────────────────────────────┐
                        └─> M4 /scout mini-app ──> M5 lessons + citation layer
                                                        │
                                    M6 Tier 2 / paid ───┘  (gated, optional)
```

**Part A** (M0–M3) makes the existing product smarter. **Part B** (M4–M5) is the
standalone guide launched from the homepage button. They share the registry and
nothing else.

M4 depends on M1 for live leaderboards but **not** on M2 or M3. Once M1 lands, Part A
and Part B run in parallel — and either can ship without the other, which is the point
of splitting them.

### 1.2 Relationship to the 2026 go-live

Scout is part of **Stats / player research**, which is in launch scope. It does not
touch flag-gated surfaces (big board, weekly ranks, consensus, community, start-or-sit,
personas, teams) and must not un-gate any of them.

**Part A (M0–M3) is launch scope. Part B (M4–M5) is launch-desirable. M6 is post-launch.**

Two flags, not one — Part A and Part B release independently, which is the whole
reason for the split. Both follow the one-flag-per-surface convention in
`src/lib/feature-flags.ts`:

- `NEXT_PUBLIC_FLAG_SCOUT_METRICS` — Part A: advanced columns, the rail explainer, the Advanced tab.
- `NEXT_PUBLIC_FLAG_SCOUT_GUIDE` — Part B: `/scout`, and the homepage button that launches it.

The homepage button and the `/scout` routes ship on the **same** flag. A button that
opens a 404 is worse than no button, and this is the same failure the existing
`sitemap.ts` already guards against for personas.

---

## 2. Milestones

### M0 — Metric registry and the rail explainer

**No new data. No migrations. No API routes.** Pure front-end + a typed data file.

**Build:**
- `src/lib/metrics/` — `types.ts`, `registry.ts`, `format.ts`, `registry.test.ts` (spec §4).
- Registry seeded with the metrics that already exist in the app: target share, snap %, plus every current stat-center column. Each gets a real `plain`, `impact`, `insteadOf` and `watchOut`, within the §4.5 length ceilings, plus stability evidence where citable.
- `MetricPanel` — renders inside the existing `RailPanelShell`; **no new panel chrome** (spec §6.3). Definition, fantasy consequence, the swap, formula, distribution context.
- `useRailStore` gains a contextual `metric` tool + `metricSlug` + `openMetric(slug)`. No permanent strip button — it opens from an ⓘ only.
- ⓘ trigger is a real `<button>` on every metric label. **No hover tooltip anywhere** (spec §6.3).
- `SwapCard` — the `USE THIS / NOT THIS` unit (spec §4.5). The canonical content component; the hub and every metric page lead with it.
- `StatCard` — the compact registry rendering: name, abbr, stability chip, one-line impact, "use instead of" footer.
- `StabilityChip` — sticky / moderate / noisy / unknown, using reserved semantic tokens. Labels are plain-language (`Repeats`, `Coin flip`), not statistical.
- Wire the ⓘ into every column header in `players-spreadsheet.tsx` and every metric label on the player profile.
- Mobile: the panel renders as a bottom sheet below `lg:`.

**Gate:**
- [ ] All registry integrity tests pass (spec §4.4), **including the copy-length ceilings**
- [ ] Every `live` metric has an `insteadOf` pairing, or a written reason in `PROGRESS-scout.md` for why nothing is being replaced
- [ ] Every number in the table renders mono + tabular at regular weight (spec §7.1) — verified by test
- [ ] Every stat-center column header has a working ⓘ that opens the panel — verified by test, not by eye
- [ ] Keyboard accessible: ⓘ is a real button, Escape closes, focus enters the panel on open and returns to the trigger on close
- [ ] Panel state persists across navigation like every other rail tool
- [ ] Below `lg:` the panel renders as a bottom sheet — verified on a real viewport
- [ ] **No hover-triggered popover ships** — verified by test
- [ ] No new shared component beyond those approved above; `MetricPanel` reuses `RailPanelShell`
- [ ] `type-check` + `lint` clean

**Ships:** an immediately better stat center. Independently valuable.

---

### M1 — nflverse Tier 1 pipeline

**Build:**
- `supabase/migrations/0XX_player_metrics.sql` — `player_metrics` table, RLS (anon read, no authenticated write), indexes, `player_metrics_season` materialized view (spec §5).
- `scripts/sync-advanced-metrics.py` — modelled on the existing `load-historical-stats.py`, reusing its `.env.local` loader, ID crosswalk and batching.
  - Build against **`stats_player`**, not the deprecated `player_stats` release. New column names (`passing_interceptions`, `sacks_suffered`); legacy names as aliases only (spec §2.3).
  - Sources: `stats_player` (target share, air yards share, WOPR, RACR, PACR, receiving EPA, CPOE), `load_pbp` derivations (aDOT, red zone share, success rate), `load_ff_opportunity` (expected points, points over expected, expected TDs).
  - ID crosswalk `gsis_id → sleeper_id` via `load_ff_playerids()` / `import_ids()`. **Expect nulls** — only `mfl_id` is complete upstream. Log unmatched counts the way the existing sync scripts do; never silently drop.
- `data_sources` attribution registry (spec §5.4).
- Backfill seasons per open question #4 (recommendation: 2019 onward).
- Registry entries flip from `planned` to `live` as their data lands.

**Gate:**
- [ ] Sync is idempotent — running twice produces identical rows
- [ ] Row counts and unmatched-ID counts reported per season, per source
- [ ] Spot-check 10 known players against a public source; values match
- [ ] Anon can `SELECT`; authenticated cannot `INSERT`/`UPDATE`/`DELETE` — proven by a pgTAP test in `supabase/tests/`, matching the existing suite's style
- [ ] Materialized view refresh is part of the sync, not a manual step
- [ ] **No Tier 2, 3, or 4 source is touched** — verified by grep in the gate script
- [ ] Attribution string present for every source written

---

### M2 — Stat center integration

**Build:**
- **Rebuild the table header as two tiers** — group band over column headers, sticky, with group rules (spec §7.1, library node `75:743`). This is a restructure of `players-spreadsheet.tsx`, not a column addition, and it is the largest single piece of M2.
- **Value + positional-rank chip in every stat cell**, ramp bucketed by league size (default 12, read from league settings where one exists — **do not hardcode**).
- **ⓘ button on every column header**, opening the rail `MetricPanel` built in M0.
- Column defs derive from the registry (`label`, `full`, `higherIsBetter`, formatting) instead of restating them.
- Advanced metrics grouped under **Pro Metrics**, replacing the current `adv` flag's "more box score columns" meaning.
- **Interactions (spec §7.2, library node `62:484`):** frozen headers on both axes, row+column crosshair highlight, axis transpose, drag-to-reorder for stat groups. Orientation and group order persist per user.
- Qualification gating: below `qualification.min`, render `—`; the reason shows as a chip beside the player and in the panel — never a small-sample number (spec §9).
- Percentile-based cell shading using the `tier` ramp.
- Position-aware column visibility (air yards share is meaningless for a kicker).

**Gate:**
- [ ] Zero metric strings duplicated between the registry and the component — verified by test
- [ ] Below-threshold values never render as numbers — verified by test
- [ ] Sort direction correct for every `higherIsBetter: false` metric
- [ ] Rank chip buckets scale with league size — verified by test at 8, 10, 12 and 14 teams
- [ ] Both orientations render from **one** component and one dataset — verified by import graph; a second table component fails the gate
- [ ] Crosshair: frozen label cells highlight with their row but never originate a crosshair
- [ ] Crosshair survives virtualization — highlighting must not depend on all rows being mounted
- [ ] Group reorder never moves the Details anchor group; order and orientation persist across reload
- [ ] Sticky cells are opaque — no content bleeding through on either scroll axis
- [ ] Both header rows stay sticky through vertical scroll; group rules align to column boundaries
- [ ] Table still virtualizes and stays responsive with the added columns
- [ ] Mobile: horizontal scroll with frozen name column

---

### M3 — Player profile Advanced tab + trait grades

**Build:**
- **Trait model** (spec §16) — `src/lib/metrics/traits.ts`, already authored in `scout-content/`. Scout grade on the player profile, with per-trait receipts on expand.
- **Flags render separately from grades** and never enter the composite. A `defaultWeight != 0` on a flag fails the model validator.
- **Build-your-own-model sliders** (spec §16.4) re-ranking a board live. Raising a low-confidence trait must surface its caveat.
- New **Advanced** tab in `player-detail-page-view.tsx` / `player-detail-panels.tsx`.
- `PercentileBar` — within position and season, over the qualified population only.
- Expected vs. actual fantasy points block — the regression argument made concrete for this player.
- Weekly trend sparkline per metric.
- Every label wrapped in `MetricTooltip`.

**Gate:**
- [ ] Percentiles computed over the qualified population only — verified by test with a fixture where an unqualified player would otherwise distort the distribution
- [ ] Unqualified players show the empty state, not a percentile of 0
- [ ] Rookie with no prior season renders cleanly
- [ ] Charts use `tier`/`pos` hues, not legacy `chart-*` vars
- [ ] `validateModels()` passes — graded weights sum to 1 per position, flags are 0, low-confidence traits have a caveat, metric weights sum to 1 per trait
- [ ] A trait with under half its input weight present returns null, not a number — verified by test
- [ ] The composite is never presented as comparable across positions (spec §16.5)
- [ ] Tab is server-rendered where possible; no waterfall fetches

---

### M4 — The Scout guide (Part B)

**Build:**
- **`ScoutShell`** — the mini-app's own header, footer and nav. Does not mount `GuestShell` or the app sidebar (spec §6.1).
- **Homepage button** in `src/app/page.tsx`, between the hero and `GuestBigBoard`: "Become a Field Scout — free guide to spotting the best players before your leaguemates." Links to `/scout`, opens in a new tab, `variant="blue"` (spec §6.0).
- Stable section anchors on every metric page (`#stability`, `#limitations`, `#distribution`) so future articles can cite a claim rather than a page (spec §14).
- `/scout`, `/scout/lessons/<slug>`, `/scout/<metric>`, `/scout/<metric>/leaders`, `/scout/<metric>/leaders/<season>`, `/scout/positions/<position>` (spec §6.1).
- The **five-lesson path** on the hub with local progress; every lesson numbered, prev/next, ending in an action button to the leaderboard that performs it.
- **Position pages** — every metric ranked by stability with the "below here it's mostly luck" divider, plus the three-metric shortlist and the don't-bother list.
- **`buy` chip on leaderboards** where role rank leads scoring rank by a set margin. Threshold lives in the registry, not in the component.
- `generateStaticParams` over the registry; ISR on leaderboards.
- `generateMetadata()` per route; per-metric `opengraph-image.tsx`.
- `BreadcrumbList` + `DefinedTerm` JSON-LD. **No `FAQPage` markup.**
- `sitemap.ts` extended — `live` metrics only, `planned` excluded.
- Conversion: save-as-list, star-a-player, sticky footer after 60% scroll. **Capability gated, prose never** (spec §8.4) — top 25 of a leaderboard free, rows 26+ and export behind a free account. No modals, no interstitials, no truncated paragraphs.
- Attribution footer.

**Gate:**
- [ ] Every metric page's primary content is present in the initial HTML — verified with JS disabled
- [ ] No two pages share a title or meta description — verified by test over the registry
- [ ] Every published page passes the §8.3 substance checklist: live data, distribution context, worked example with a named player, unique hand-written copy
- [ ] `planned` metrics render the explicit "not yet" page and are absent from the sitemap
- [ ] Lighthouse SEO ≥ 95 on a metric page
- [ ] Every lesson ends in an action with a working link to the surface that performs it — checked per lesson
- [ ] Lesson progress is localStorage only; no lesson requires an account to read or to mark read
- [ ] Structured data validates
- [ ] **Logged-out user can read 100% of every word on every page** — verified by test, not by eye
- [ ] `/scout` renders in `ScoutShell` with zero imports from the app shell — verified by import graph
- [ ] Homepage button and `/scout` are on the same flag; with the flag off, neither exists
- [ ] **Publish in waves of 10–15 with a human editorial pass. Do not publish all metric pages in one day** (spec §8.3)

---

### M5 — Lessons and the citation layer

**Build:**
- Five launch lessons (spec §6.5), hand-written.
- Reciprocal linking: lessons ↔ metric pages.
- **Citation contract** (spec §14): a documented, tested way for an outside article to pull a metric's figures from the registry rather than restating them. This is what makes Scout the resource your future insight articles are derived from.
- Link out to `/scout` from the Players/Research header for signed-in users. **No in-app copy of the guide.**
- `NEXT_PUBLIC_FLAG_SCOUT_GUIDE` removed once the gate passes.

**Gate:**
- [ ] Every lesson's factual claims verified against a cited source
- [ ] Every metric referenced in a lesson links to its page, and that page links back
- [ ] No stability figure or formula appears anywhere outside the registry — verified by a test that greps for hardcoded values
- [ ] Section anchors resolve and are covered by a test (they're permanent public URLs)
- [ ] Voice review by Chris

---

### M6 — Tier 2 and the paid adapter *(gated, post-launch)*

**Blocked on open question #1** (spec §12). Do not start without an explicit written
decision.

**Build:**
- Tier 2 (NGS, PFR advanced) behind the legal sign-off. Separation and cushion ship **with a `noisy` stability chip** — publishing them honestly is the point (spec §3).
- Tier 3 (FTN) in physically separate tables if ever adopted, preserving share-alike isolation.
- Paid-source adapter: prove routes-run-derived metrics (YPRR, TPRR) flip from `planned` to `live` **by adding rows and a `source`, with no migration**. That is the architectural claim in spec §5.1, and M6 is where it gets tested.

**Gate:**
- [ ] Written legal decision recorded in `PROGRESS-scout.md` before any Tier 2 code
- [ ] Attribution correct per tier
- [ ] Adding a paid source required zero schema changes — if it didn't, the §5.1 claim was wrong and the spec needs a changelog entry

---

## 3. Definition of Done

Per task, per PR — no exceptions:

- Tests green, **shown not claimed**
- `npm run type-check` clean
- `npm run lint` clean
- Registry integrity tests pass if the registry changed
- pgTAP RLS test passes if schema changed
- `PROGRESS-scout.md` updated
- Small commit citing the spec §
- **Branch + PR. Never a direct commit to main. One task, one PR.**

---

## 4. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Tier 2 licensing** turns out to be a real blocker | Medium | Tier 1 alone is a complete launch. M6 is optional by construction. |
| nflverse **schema drift** (`player_stats` → `stats_player` already happened) | High | Build against the new schema; alias the old. Sync fails loudly on unexpected columns rather than writing nulls. |
| **ID crosswalk gaps** — rookies and practice-squad players lack `sleeper_id` | High | Expected and logged, matching the existing sync scripts. Never silently drop; surface unmatched counts in the run summary. |
| Metric pages read as **thin/programmatic** | Medium | §8.3 is a binding gate, not advice. Waves of 10–15, human pass, no empty payloads. |
| **Scope creep** toward composite grades and similarity | High | Spec §10 names them as non-goals with reasons. Any move on them needs a spec changelog entry first. |
| Registry becomes a **dumping ground** | Medium | Integrity test #8 blocks duplicated copy. ~40 entries is a ceiling for M0, not a target. |
| **Participation data** gets adopted as a routes proxy under deadline pressure | Medium | Spec §2.1 forbids it explicitly. It counts blocking TEs as route-runners — wrong exactly where it matters. |

---

## 5. Explicitly not in this plan

- Composite trait grades, player similarity, weight sliders, time machine, college/prospect metrics, AI metric queries — all spec §10 non-goals, each needing its own spec.
- Any change to flag-gated launch surfaces.
- Any `is_pro` gate on Scout (spec §11.1).

---

## Changelog

- **v1.7** — M3 absorbs the trait model and the weight sliders (spec §16). Content is
  already written (`scout-content/traits.ts`), so this is wiring plus percentile plumbing,
  not design work.
- **v1.6** — M4 gains the full guide IA: the five-lesson path, lesson pages, position
  pages, and the leaderboard `buy` chip (spec §6.1). M5 shrinks to writing the lesson
  *content* plus the citation contract, since the lesson template now lands in M4.
- **v1.5** — Tooltips dropped in favour of the rail `MetricPanel` (spec §6.3). Removes the
  portal/floating-tooltip work from M2 and moves the explainer into M0, where it reuses
  `RailPanelShell` and `useRailStore` rather than adding a primitive. Net: less code than v1.4.
- **v1.4** — M0 gains `SwapCard` and `StatCard` as the canonical content components
  (spec §4.5). Copy-length ceilings become a gate. M5's lessons shrink accordingly —
  the swap cards now carry most of the teaching load, so the lessons are the deep cuts
  rather than the primary format.
- **v1.3** — M2 absorbs the §7.2 interaction set (frozen axes, crosshair, transpose,
  group reorder). Worth flagging: M2 is now the largest milestone in the plan, and the
  transpose plus crosshair work is independent of the metric pipeline — it could split
  into its own PR ahead of M1 if the table work wants parallelising.
- **v1.2** — M2 re-scoped against FieldScout Library node `75:743` (spec §7.1): the
  two-tier header and rank-chip cells make it a table restructure rather than a column
  addition. Adds a gate for league-size-aware rank buckets. (The tooltip-clipping gate
  this version added was removed in v1.5 — the rail panel makes it moot.)
- **v1.1** — Resequenced for the two-part model (spec v1.1). Milestones now split
  explicitly into **Part A** (M0–M3, in the product, launch scope) and **Part B**
  (M4–M5, the standalone guide). M4 gains `ScoutShell`, the homepage button and
  section anchors; M5 swaps the in-app tab for the citation contract. Two release
  flags instead of one so the halves ship independently.
- **v1.0** — Initial plan. Seven milestones, canonical order, no dates. M0 deliberately data-free so the architecture is validated and value ships before ETL risk is taken on.
