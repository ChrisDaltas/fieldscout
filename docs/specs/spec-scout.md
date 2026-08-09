# Spec: Scout — advanced metrics, explained (LAW)

**Status:** v1.7 — draft for Chris's sign-off
**Owner:** Chris
**Depends on:** 2026 go-live scope (CLAUDE.md → Active Builds). Scout is an extension of **Stats / player research**, which is in launch scope.
**Related:** `spec-player-research.md`, `spec-ai-list-generation.md`, `docs/03-DATA-MODEL.md`, `docs/redesign-plan.md`

> This spec is LAW. If code and spec conflict, the code is wrong. If the spec seems
> wrong or ambiguous: STOP, write the question + your recommendation to
> `PROGRESS-scout.md` under "Spec questions". Never improvise around the spec.

---

## 1. What this is

**One metric knowledge layer, shipped as two products.**

Every advanced metric FieldScout knows about is defined exactly once, in a typed
registry (§4). That single definition feeds both halves of this spec:

### Part A — Metrics in the product *(in-app, signed in)*

The advanced data itself, woven into surfaces that already exist:

1. **A hover tooltip** anywhere a metric appears — the stat center, the player profile, a list.
2. **A column** in the stat center with correct formatting, sort direction and qualification rules.
3. **A percentile bar** on the player profile's new Advanced tab.

Part A has no new navigation and no new page. It makes the app FieldScout already
has smarter, and it is the half that belongs to launch scope.

### Part B — The Scout guide *(standalone, public)*

A self-contained mini-app at `/scout`, launched from a button on the marketing
homepage and opened in its own tab. Its own shell — not the app sidebar, not the
app chrome. A visitor can land on it having never heard of FieldScout, read it end
to end, and leave smarter.

The homepage entry point is the product's first promise:

> **Become a Field Scout** — our free guide to spotting the best players before
> your leaguemates.

Part B is the acquisition surface. Part A is the retention payoff. They share a
registry and nothing else — **Part B must never import the app shell, and Part A
must never depend on Part B being built.** Either can ship without the other.

There is no second glossary, no separate copy deck, no duplicated formula. One
registry entry, every rendering. Anything that can't be expressed as a registry
entry is not a metric — it's a lesson, and it lives in `/scout/lessons/`.

### 1.1 Why it exists (product goals, in priority order)

| # | Goal | How Scout serves it |
|---|---|---|
| 1 | **Credibility** — FieldScout knows ball | Publishes the stability evidence behind every metric, including the unflattering ones |
| 2 | **Organic acquisition** | ~40 evergreen metric pages + live leaderboards, each targeting a distinct query intent |
| 3 | **Free value before signup** | 100% of Scout is readable logged-out. The gate is on *saving*, never on *reading* |
| 4 | **Make the stat center legible** | Tooltips turn an intimidating table into a teaching surface |
| 5 | **Deepen player profiles** | Percentile context — "82nd percentile target share" beats "24.1%" |

### 1.2 Naming

The product word is **Scout**. It is one character across the app: **Scout** teaches
you (the `/scout` surface), and **Scout AI** answers your questions (existing
`ScoutInsight` / `scout-ai-card`). This is deliberate and not a collision — do not
rename either. Never introduce a third "Scout ___" noun without a spec change.

---

## 2. The honest data position (read this before anything else)

The feature brief that inspired this work assumed metrics like **Yards Per Route Run,
Route Win Rate, Press Win Rate, Open %, and Separation-based grades** would be
available. Grounded against real sources, that assumption is wrong in an important way,
and the entire scope below is built around the correction.

### 2.1 Routes run is not obtainable for free. Full stop.

There is **no routes-run column in any free dataset**. `load_participation()` has a
`route` field, but it describes the route the *primary receiver* ran on a single play —
it cannot be summed into per-player routes. That kills, for the free tier:

- Yards Per Route Run (YPRR)
- Targets Per Route Run (TPRR)
- Route participation rate
- Anything else with "per route" in the name

**These metrics do not go in the registry until a paid feed lands.** They get
`status: 'planned'` entries so the pages exist as "coming soon" stubs and the
architecture is proven, but they render no numbers. **Never ship a computed YPRR
from a snap-count proxy.** Snap share counts blocking TEs and pass-protecting backs as
if they ran routes; the number would be wrong in exactly the cases users care about,
and publishing a wrong YPRR on a page that claims to teach rigor is the single
fastest way to destroy goal #1.

### 2.2 What we *can* have, in licensing-risk tiers

**Tier 1 — ship now.** Computed by nflfastR from play-by-play. CC-BY 4.0, attribution
to nflverse. Lowest legal risk. This tier alone is enough for a differentiated product.

| Metric | Source | Note |
|---|---|---|
| Target share | `stats_player.target_share` | Precomputed |
| Air yards share | `stats_player.air_yards_share` | Precomputed |
| WOPR | `stats_player.wopr` | `1.5 × tgt share + 0.7 × AY share` |
| RACR | `stats_player.racr` | Air-yards conversion |
| PACR | `stats_player.pacr` | Passer air conversion |
| Receiving air yards | `stats_player.receiving_air_yards` | |
| aDOT | derived: `air_yards / targets` from `load_pbp()` | |
| Receiving EPA | `stats_player.receiving_epa` | |
| CPOE | `stats_player.passing_cpoe`, `pbp.cpoe` | |
| Success rate | `pbp.success` | |
| Red zone target / carry share | derived: `pbp.yardline_100 <= 20` | |
| Expected fantasy points, and points over expected | `load_ff_opportunity()` — `<stat>_exp`, `<stat>_diff` | |
| Expected TDs vs actual TDs | `ff_opportunity` | The single best regression teacher |

**Tier 2 — needs a legal read before it ships publicly.** NFL Next Gen Stats
(separation, cushion, time to throw, RYOE, xYAC) and Pro Football Reference advanced
stats (drops, pressure, broken tackles, aDOT) are redistributed by nflverse under
CC-BY, **but nflverse's grant cannot license the NFL's or PFR's underlying rights**.
nflverse states plainly: *"NFL data accessed by this package belong to their
respective owners, and are governed by their terms of use."* Tier 2 is built in M6,
gated behind an explicit sign-off, and is not required for launch.

**Tier 3 — isolate.** FTN charting and participation from 2023 on are **CC-BY-SA 4.0**
(share-alike) and require attribution to *"FTN Data via nflverse"*. Keep Tier-3-derived
rows in physically separate tables so a share-alike obligation can never be argued to
reach the rest of the product. Not in launch scope.

**Tier 4 — paid, later.** PFF / Fantasy Points Data. This is where routes run,
YPRR, TPRR, route win rate and press win rate live. The registry is designed so
adding this tier is **rows and a new `source`, not a migration**.

### 2.3 Known upstream breaking change

The nflverse `player_stats` release is **deprecated as of 2025-08-01** in favour of
`stats_player`. Column names changed: `interceptions` → `passing_interceptions`,
`sacks` → `sacks_suffered`. `scripts/load-historical-stats.py` already has a
`stats_player_week_{season}.parquet` fallback with a `COLUMN_ALIASES` map — the new
sync must build against the **new** names and treat the legacy names as aliases, not
the other way round.

---

## 3. The teaching thesis

Scout has one argument, and every page is a variation on it:

> **Opportunity is a skill. Efficiency is mostly noise. Touchdowns are weather.**

This is not a slogan — it is the published evidence, and Scout's differentiator is
that it *shows the receipts on the metrics that don't work* alongside the ones that do.

Year-over-year stability (Sharp Football Analysis, R²):

| Sticky — projectable | | Noisy — regresses |
|---|---|---|
| WR PPR pts/G | 0.567 | WR TD per target — **0.008** |
| WR targets/G | 0.539 | WR yards per target — 0.028 |
| RB touches/G | 0.567 | RB yards per touch — 0.008 |
| TE rec yards/G | 0.609 | TE TD% — **0.0002** |
| WR team target share | 0.401 | RB yards per carry — 0.031 |
| WR targets per route | 0.392 | Games played — 0.022 |

And the contrarian one, which is the most credibility-building thing Scout can say:
**NFL Next Gen Stats separation and cushion correlate poorly with fantasy production**
(contested-catch rate r ≈ 0.02, drop rate r ≈ 0.14). Every competitor publishes
separation as if it were insight. Scout publishes it with a "low signal" chip and
explains why. That is the whole brand in one component.

### 3.1 Evidence discipline (non-negotiable)

- Published figures appear as **r** or **R²**, never mixed, always labelled. R² 0.40 ≈ r 0.63; a UI that shows both on one scale is lying.
- Every stability claim carries its source and sample window in the registry entry. If a claim has no citable source, the field is `null` and the UI shows nothing. **Never invent a correlation value.**
- Where the analytics community disagrees, say so. `stabilityEvidence.contested: true` renders a "disputed" note rather than false confidence.

---

## 4. The metric registry

### 4.1 Location and shape

`src/lib/metrics/` — a new directory. Pure data + pure functions, no side effects,
importable from both Server and Client Components.

```
src/lib/metrics/
  registry.ts        → METRICS: Record<MetricSlug, MetricDefinition>  (the LAW)
  types.ts           → MetricDefinition and its unions
  format.ts          → formatMetricValue(), qualification helpers
  percentile.ts      → percentile banding, qualified-sample filtering
  registry.test.ts   → integrity tests (§4.4)
```

### 4.2 `MetricDefinition`

```ts
export interface MetricDefinition {
  /** URL segment and tooltip key. Kebab-case, stable forever — it's a public URL. */
  slug: string
  /** Storage key in player_metrics.metric_key. Snake_case, stable forever. */
  key: string
  name: string                    // 'Target share'  — sentence case, always
  abbr: string                    // 'TGT%'          — the only place caps are allowed
  category: MetricCategory
  /** Positions the metric is meaningful for. Empty = all. */
  positions: Position[]
  unit: 'percent' | 'yards' | 'count' | 'rate' | 'points' | 'index' | 'seconds'
  precision: number
  /** Sort direction and percentile polarity. */
  higherIsBetter: boolean

  /** Human-readable formula. Renders small, on the full page only — never in a hover. */
  formula: string

  // --- Copy. Hard limits, enforced by test. See §4.5. ---
  /** ≤110 chars. What it is, in words a first-year player understands. */
  plain: string
  /** ≤160 chars. What it means for YOUR team. Never a definition — always a
   *  consequence: draft him, start him, buy him, ignore this. */
  impact: string
  /** The "this, not that" pairing. Null only when nothing is being replaced. */
  insteadOf: { metric: string; because: string } | null   // because ≤180 chars
  /** 0–2 items, ≤140 chars each. Replaces prose limitations. */
  watchOut: string[]

  stability: 'sticky' | 'moderate' | 'noisy' | 'unknown'
  stabilityEvidence: StabilityEvidence | null
  /** 1–5. Editorial, and defensible against the evidence above. */
  predictiveness: 1 | 2 | 3 | 4 | 5

  type: 'volume' | 'opportunity' | 'efficiency' | 'expected' | 'composite'
      | 'tracking' | 'athletic' | 'situational'

  source: DataSource
  licenseTier: 1 | 2 | 3 | 4
  status: 'live' | 'planned'      // 'planned' = page exists, no numbers
  seasonsFrom: number | null

  /** Below this sample the value is suppressed, not shown greyed. */
  qualification: { field: string; min: number; label: string } | null
  /** Slugs. Powers "related metrics" and the internal link graph. */
  related: string[]
  /** Named traps. Render as warning chips on the metric page. */
  traps: TrapId[]
}

export interface StabilityEvidence {
  statistic: 'r' | 'r2'
  value: number
  sampleWindow: string            // '2017–2023, WR, 30+ targets'
  sourceName: string
  sourceUrl: string
  contested: boolean
}
```

**Categories** (`MetricCategory`): `opportunity`, `efficiency`, `volume`,
`expected`, `situational`, `athletic`, `passing`, `rushing`, `receiving`.

**Traps** (`TrapId`, a closed union — each maps to one reusable explainer):
`small-sample`, `td-regression`, `garbage-time`, `empty-air-yards`,
`snap-share-proxy`, `season-totals`, `rb-efficiency`.

### 4.3 Launch registry contents

Approximately **40 entries** at launch — 28 `live` (all Tier 1), 12 `planned`
(Tier 2/4 stubs). Deliberately not 200. Every entry must earn its page by saying
something specific and true that no other page says (§8.3). The count is a ceiling
for M0, not a target to pad toward.

### 4.5 Voice and length *(binding)*

**People don't read. They skim, decide, and leave.** Scout's job is to change one
draft decision in ten seconds, not to be correct at length. Every word competes with
the user closing the tab.

**"This, not that" is the primary format.** It is not a stylistic preference — it's
the shape of the argument. Scout's whole thesis is a set of substitutions: opportunity
repeats, efficiency doesn't, so *swap these stats for those stats*. A swap is
memorable, actionable, and immediately testable against the user's own draft board.
A definition is none of those things.

The canonical unit is the **swap card**: `USE THIS / NOT THIS`, one sentence of why,
one line of when it applies. Metric pages lead with it. The hub is a grid of them.

**Rules:**

1. **Fantasy consequence, never definition, in `impact`.** "Below it? Buy him. Above it? Sell high." beats "measures touchdown regression."
2. **No jargon without a plain-English gloss in the same sentence.** If a sentence needs "correlation", "variance", or "regression to the mean", rewrite it. Say "coin flip", "repeats", "he's due".
3. **Formulas do not appear in hovers.** Definition, consequence, swap — that's the hover. The formula lives on the full page for the people who want it.
4. **Second person. Active voice. No hedging.** "A guy with a big slice keeps scoring" — not "players with elevated target share tend to demonstrate more stable production."
5. **Numbers only when they land.** "3 touchdowns one year and 12 the next" lands. "R² of 0.008" does not — that belongs in the evidence block, which is for the people who came to check.
6. **No sentence over ~20 words.** No paragraph over three sentences.

**Evidence discipline (§3.1) is unchanged.** Plain language is not permission to be
imprecise: the stability figures still carry their source and sample, and a claim
without a citable source still renders as absent. Scout says "basically random" *and*
shows R² 0.008 — the phrasing is for the skimmer, the figure is for the skeptic. Both
are on the page; only one is in the hover.

### 4.4 Registry integrity tests (`registry.test.ts`)

These run in CI and are part of Definition of Done for every milestone that touches
the registry:

1. Slugs are unique, kebab-case, and match `/^[a-z0-9-]+$/`.
2. Keys are unique and snake_case.
3. Every `related` slug resolves to a real entry, and relationships are **symmetric**.
4. Every `live` metric has a non-null `seasonsFrom` and a `source`.
5. `stabilityEvidence` is null **or** fully populated — never partial.
6. No entry has empty `plain` or `impact`.
7. **Length ceilings hold** — `plain` ≤ 110, `impact` ≤ 160, `insteadOf.because` ≤ 180, each `watchOut` ≤ 140. A build that exceeds them fails; this is the only thing that reliably stops copy creeping back up over time.
8. No two entries share a `plain` or `impact` string (catches copy-paste padding, the §8.3 spam risk).
8b. No sentence in `plain` or `impact` exceeds 20 words (§4.5 rule 6).
9. Every `TrapId` used is in the closed union and has an explainer.
10. `licenseTier >= 2` implies `status: 'planned'` until the M6 gate flips it.

---

## 5. Data model

### 5.1 Narrow, not wide — and why

Metrics are stored **long/narrow**, one row per player-season-week-metric:

```sql
CREATE TABLE player_metrics (
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season      INTEGER NOT NULL,
  -- 0 = season summary (matches the Next Gen Stats convention). 1..18 = weekly.
  week        INTEGER NOT NULL,
  metric_key  TEXT NOT NULL,
  value       NUMERIC,
  -- Denominator behind the value, for qualification gating (targets, attempts…).
  sample      INTEGER,
  source      TEXT NOT NULL,        -- 'nflverse-pbp' | 'nflverse-stats' | 'ff-opportunity' | …
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, season, week, metric_key)
);
```

This is the direct consequence of the **"nflverse now, paid later"** decision. Adding
a paid feed later inserts rows with a new `source` — **no migration, no column
sprawl, no 60-column table where 40 columns are null for every QB.** A wide table
would force a migration for every new metric and every new vendor.

The cost is read ergonomics, paid for by §5.2.

**Percentiles are computed, never stored.** They depend on the qualified population,
which changes weekly. Storing them guarantees they go stale.

### 5.2 Read path

`player_metrics_season` — a materialized view pivoting `week = 0` rows into the wide
shape the stat center and player profile want, refreshed at the end of each sync run.
The spreadsheet and profile read the view; nothing reads the narrow table directly
except the sync and the leaderboard queries.

Indexes: `(metric_key, season, value DESC)` for leaderboards;
`(player_id, season)` for profiles.

### 5.3 RLS

`player_metrics` is **read-only player data** (CLAUDE.md → Important Notes). Anon
`SELECT` policy true; **no** insert/update/delete policy for `authenticated`. Writes
happen only via the service role from the sync job, exactly like `players` and
`player_stats`.

### 5.4 Attribution

A `data_sources` registry entry per source with the required attribution string.
Rendered in the footer of every Scout page and in the stat center's "about this data"
popover. Tier 1 renders *"Data via nflverse"*. This is a licence obligation, not a
nicety — CC-BY requires it.

---

## 6. Surfaces

### 6.0 Entry point — the homepage button

`src/app/page.tsx` (the guest landing page) gains a Scout call to action, placed
between the hero and `GuestBigBoard`. Copy direction, to be finalised in Chris's
voice:

> **Become a Field Scout**
> Free guide: how to spot the best players before your leaguemates.
> `[ Start the guide → ]`

Rules:
- Links to `/scout`, `target="_blank" rel="noopener"` — it opens in its own tab, per the mini-app framing.
- Rendered for logged-out visitors on the marketing homepage. Signed-in users reach the same `/scout` from the Players/Research surface header, not from a nav item.
- **Not release-gated with the community/consensus block.** Scout is launch scope; that block is not.
- The button is a `variant="blue"` primary — this is a "do a thing" moment, so ultramarine, not lime (§7).

### 6.1 The guide (`/scout/*`) — its own shell, server-rendered, no auth

Part B runs on a `ScoutShell` — its own header, its own footer, its own nav. It does
**not** mount `GuestShell` or the app sidebar. A visitor should be able to tell they're
in a guide, not in a logged-out view of an app.

| Route | Purpose | Rendering |
|---|---|---|
| `/scout` | Hub. The path, the swap grid, the evidence, the stat cards | Static |
| `/scout/lessons/<slug>` | One lesson in the path — numbered, prev/next, ends in an action | Static |
| `/scout/<metric>` | One metric: leads with its swap, then what it is, why you care, watch-outs, evidence, distribution, live top-10 | `generateStaticParams` over the registry, ISR for the top-10 |
| `/scout/<metric>/leaders` | Full leaderboard, sortable, filterable by position | ISR |
| `/scout/<metric>/leaders/<season>` | Archived season | Static after season close |
| `/scout/positions/<position>` | "What actually matters for a WR" — every metric ranked by how well it repeats, with an explicit below-this-line-is-luck divider | Static |

**Structure: a path over a reference.** The guide is five numbered lessons in order —
that's what "Become a Field Scout" promises and what the homepage card advertises — but
every metric, leaderboard and position page stands alone and is individually indexed.
A visitor arriving from search on "what is target share" never sees a course; a visitor
arriving from the homepage button gets one. Progress is a local view preference
(localStorage), never an account requirement.

**Every lesson ends in an action, not a summary.** "Sort last season by touchdowns, then
by target share — anyone high on the second list and low on the first is your buy list,"
with a button straight to that leaderboard. A lesson that ends in a recap has taught
nothing the reader will act on.

**Leaderboards close the loop.** A `buy` chip marks players whose role rank is well
ahead of their scoring rank — the exact pattern the touchdown lesson just described.
This is what stops the guide being an article and makes it a tool.

**Rules:**
- Server Components only. No client-side fetch for primary content — a metric page must be fully present in the initial HTML.
- Breadcrumbs on every page, with `BreadcrumbList` structured data.
- `generateMetadata()` per route off the registry: unique title, unique 140–160 char description. **Templated descriptions with the metric name swapped in are forbidden** (§8.3).
- Per-metric `opengraph-image.tsx` rendering the metric name + current top 5.
- `DefinedTerm` / `DefinedTermSet` JSON-LD on metric pages. Note: this earns **no rich result** in Google today — emit it for machine extraction and AI answer engines, and budget zero SEO effort against a rich-result payoff.
- **No `FAQPage` markup.** FAQ rich results were dropped in 2026. Keep FAQ *content*, drop the schema.
- Self-canonical everything. Do not emit a dated leaderboard URL for the in-progress season — it would duplicate the undated one.
- `sitemap.ts` extends to include every `live` metric page and leaderboard. `planned` metrics are **excluded from the sitemap** — we never advertise a URL with no content (this matches the existing personas-flag precedent in `src/app/sitemap.ts`).

### 6.2 What signed-in users get

Not a duplicate of the guide. Signed-in users get **Part A** — tooltips, advanced
columns, percentile bars — plus a link out to `/scout` from the Players/Research
header for anyone who wants the long-form version. There is no in-app copy of the
guide and no forked component tree (CLAUDE.md → Components).

This replaces the earlier "in-app tab" plan (v1.0 §6.2). Chris's call, and the right
one: a guide is a destination you visit, not a tab you live in. Duplicating it inside
the shell would have meant two renderings of the same content competing for the same
search results.

### 6.3 The metric explainer — click, not hover

**There is no hover tooltip.** The ⓘ on a column header is a **button**, and it opens
the metric in the **right rail** — the existing `ResearchRail` (45px ink strip + 256px
slide-out panel), alongside Notifications, Messages, Teams and Players.

**Why this beats a tooltip, concretely:**

1. **Hover misfires constantly on a dense table.** Sixteen columns means the pointer crosses headers on its way everywhere. A card that appears uninvited while you're scanning is noise, and it covers the data you were reading.
2. **It kills the clipping problem.** A popover inside a horizontally-scrolling table gets clipped by its scroll container; the prototype needed `position: fixed` with manual placement to work around it. A rail panel is outside the table entirely — no portal, no floating library, no edge-flipping.
3. **It stays put.** You can read the explainer while scanning ten players against that column. A tooltip dies the moment you move the mouse — which is exactly when you'd start using what it told you.
4. **Room for real content.** 256px × full height fits definition, fantasy impact, the swap, the formula, and distribution context ("what's a good number"). A hover card fits two sentences.

**Implementation:**

- `MetricPanel` renders inside `RailPanelShell` (title + close on the 37px head), exactly like the existing panels. **No new panel chrome.**
- `useRailStore` gains a `metric` tool plus a `metricSlug: string | null`, and an `openMetric(slug)` action. It persists like every other rail tool, so the panel survives navigation.
- `metric` is **contextual, not browsable** — it gets no permanent button in the icon strip. It opens from an ⓘ and closes from the panel head or Escape.
- The active ⓘ takes a filled accent state so the user can see which metric the panel is showing.
- Panel content: name, `abbr`, stability chip, `plain`, `impact`, the swap block, the formula, and distribution context. Footer: "Full story →" to `/scout/<slug>`.

**Where there is no rail:**

- **The guide (Part B)** has its own shell and no rail. The same `MetricPanel` renders in a right slide-over sheet. Same component, same content, different container.
- **Mobile / below `lg:`** — the rail is hidden. The panel becomes a bottom sheet.

**Every metric label still needs an ⓘ.** A metric rendered anywhere without a route to
its explainer is a bug — that part of the v1.0 contract is unchanged.

**Accessibility:** the trigger is a real `<button>` with `aria-label="What is <name>?"`,
Escape closes, and focus moves into the panel on open and returns to the trigger on close.

### 6.4 Stat center and player profile

**Stat center** (`players-spreadsheet.tsx`) — extend in place. The existing `adv` flag
is currently just "more box-score columns"; it becomes a real **Advanced** column group
driven by the registry. Column defs derive `label`, `full`, `higherIsBetter` and
formatting from the registry rather than restating them. Values below `qualification.min`
render as `—` with a tooltip explaining the threshold, **not** as a number.

**Player profile** — a new **Advanced** tab beside Overview / Stats / Game log:
- Percentile bars per metric, within position and season, over the qualified population only.
- Opportunity vs. production: expected fantasy points against actual, which makes the regression argument concrete for that specific player.
- A weekly trend sparkline per metric — the "role changed in week 10" signal that season averages hide.
- Every label wrapped in `MetricTooltip`.

### 6.5 Lessons

Long-form, hand-written, one per idea. These are the pages that carry the argument and
earn links. Launch set — each is a real, verifiable case:

1. **Why touchdowns lie** — Cooper Kupp 2020 → 2021. 124 targets and 3 TDs became 191 targets and 16 TDs. The opportunity was already there; only the noisiest stat in football was missing.
2. **The same story, six years earlier** — Mike Evans 2015 → 2016. 148 targets / 3 TDs → 173 / 12.
3. **Read the last six weeks, not the season** — Amon-Ra St. Brown's rookie close: six straight games of 10+ targets. A role change, not a hot streak.
4. **Rate before volume** — DeVonta Smith 2021 → 2022: target-earning rate flagged him a year before the box score did.
5. **What separation doesn't tell you** — the contrarian piece. Why the most-televised tracking metric has almost no fantasy signal.

Each lesson links to the metric pages it uses; each metric page links back to lessons
that feature it. That reciprocal linking is the internal link graph, and it is the
thing competitors don't have.

---

## 7. Design

Field Scout design language, tokens from `tailwind.config.ts`. Binding rules:

- **Single blended theme.** No dark mode, no `dark:` variants, no `next-themes`.
- **Ultramarine `accent` #3d5cff = "do a thing"** — buttons, tabs, links, selection, AI. **Lime `brand` #b4ff89 = "look here"** — live signals, callouts. Lime is never a control.
- `positive` / `negative` / `caution` are **reserved for up/down/caution semantics only** — never identity. Stability chips qualify; a metric category colour would not.
- 1px radius everywhere. Hard un-blurred offset shadows (`shadow-hard-4/6/8`), never soft.
- Sentence case for all labels. The only caps are stat abbreviations (`TGT%`, `WOPR`, `aDOT`) — that's what `abbr` is for.
- All numbers use `.fs-num` (Roboto Mono, tabular).
- Headings weight 800, `-0.01em`. Body weight 500.
- Motion is linear, 200ms, functional. No bounce.
- Charts use the `tier` ramp and `pos` hues, not the legacy `chart-*` vars.
- Reskin `components/ui/*` in place. **No new shared component without explicit approval.** New pieces expected: `MetricTooltip`, `StabilityChip`, `PercentileBar`, `MetricLeaderboard` — each needs sign-off before it's written, and each must be justified as not-a-variant-of-something-existing.

**Design intent:** clarity over density. Scout's audience includes people who do not
yet know what target share is. That is the entire point of it.

### 7.1 The stat table pattern *(binding)*

Source of truth: **FieldScout Library, node `75:743`**. The advanced columns adopt this
pattern rather than extending the current dense table.

**Two-tier header.** A group band (`Details · Fantasy Ranking · Fantasy Scoring ·
Receiving · Pro Metrics`) sits above the column headers, centred per group, with a
`#dddedf` vertical rule at each group boundary running the full table height. Advanced
metrics live under **Pro Metrics**. Both header rows are sticky.

**Every column header carries an ⓘ.** This replaces the dotted-underline trigger from
the v1 prototype — the icon is explicit, discoverable, and already in the library.
The ⓘ *is* the `MetricTooltip` trigger from §6.3; the contract is unchanged.

**Every stat cell is a value plus a positional-rank chip** — value left, rank right.
This is the single biggest legibility win: "1,204 yards" means nothing on its own,
"1,204 · 13th" means everything. The rank is within position and season, over the
qualified population (§6.4).

**Rank chip ramp** — buckets are **fantasy positional tiers in a 12-team league**, not
percentiles. Tokens are the library's:

| Rank | Tier | Background | Text |
|---|---|---|---|
| 1–12 | WR1 / RB1 / QB1 | `#E6F8D3` | `#29470B` |
| 13–24 | tier 2 | `#FDF8DD` | `#524704` |
| 25–36 | tier 3 | `#ffeddc` | `#5b2e01` |
| 37+ | tier 4+ | `#FDE7EE` | `#51041D` |

Bucket size follows league size, so it must come from the user's league settings where
one exists and default to 12 otherwise. **Do not hardcode 12.**

**Rank badges** in the Fantasy Ranking group are filled circles: Overall = ink, Pos =
the position colour, Flex = `#c42e86` (`pos-flex`).

**Unqualified cells** render `—` in `#b9babc`, never a number and never a rank chip
(§9). The qualification reason surfaces as a chip beside the player's name.

**Type scale — small and light.** Group band 10.5px, column header 10.5px, cell value
12px, player name 11.5px, rank chip 9.5px, row height 36px.

**Two rules that matter more than the numbers:**

1. **Every number is mono and tabular** — `.fs-num` / Roboto Mono, per the design system's "use on every stat / number block". Digits must align down a column; proportional figures make a stat table impossible to scan vertically.
2. **Regular weight, not bold.** Values render at 500. A full column of bold is a wall — when everything is emphasised nothing is, and the eye has no way to pick out the number it wants. Emphasis in this table comes from the rank chip's colour, not from font weight.

Units (`pts`, `td`, `%`) render one step smaller and in `#85878a`, so the eye lands on
the digits rather than the label.

**Two deviations from the global design law, both deliberate, both inherited from the
library node:** rank chips use a ~3px radius rather than the global 1px, and rank
badges/avatars are fully round. Round avatars are already carved out in the design
system; **the chip radius is not, and needs Chris's ruling** — match the library (3px)
or conform to the 1px rule. Recorded as open question #8.

### 7.2 Table interactions *(binding)*

Component states: **FieldScout Library, node `62:484`**.

**1. Frozen headers on both axes.** The table scrolls under its headers like a
spreadsheet. Vertically: the group band and column header row both stick to the top.
Horizontally: the rank column and the player column stick to the left, with a `#dddedf`
edge rule marking the freeze boundary. Sticky cells need an opaque background or
scrolled content shows through — a real bug class, not a polish item.

**2. Crosshair highlight.** Hovering any data cell highlights its **entire row and
entire column**. The user's question is "am I reading the right stat for the right
player", and on a 16-column table that question is constant.

| Element | Treatment |
|---|---|
| Row and column band | `#eff8fe` (Blue/50) |
| The hovered cell | `#dce4ff` (accent-soft) + 1px accent inset ring |
| Column header | `#dce4ff` + 2px accent underline |
| Frozen player cell in the hovered row | highlights with its row |

The library's `#f8fcff` (`025 - Highlight`) is available, but a ~2% tint doesn't
survive being scanned at speed. The band uses Blue/50 and the hovered cell gets a ring —
the prototype demonstrates the difference.

Implementation: frozen label cells carry `data-r` **only**. They light with their row
but must never originate a crosshair, or hovering a player name would highlight an
arbitrary column.

**3. Transpose.** A toggle flips the axes — stats down the left, players across the top.
Both orientations render from one dataset and one set of cell renderers; **there is no
second table component.** In transposed mode the group headers become full-width band
rows and the stat-name column is the frozen one.

This is genuinely useful rather than novelty: comparing four players across every metric
is a column-scan in transposed mode and a row-scan across 16 columns in normal mode.

Orientation persists per user (localStorage is fine — it's a view preference, not data).

**4. Drag to reorder stat groups.** Group headers are drag handles (`⠿` affix, `grab`
cursor). Dropping reorders whole groups, not individual columns. Drop target shows an
accent inset edge — leading in normal mode, top/bottom in transposed. The **Details**
group is the frozen anchor and is never draggable.

Group-level reorder rather than column-level is deliberate: it's the granularity users
actually want ("put Pro Metrics next to Fantasy Scoring"), it keeps groups coherent, and
it sidesteps the column-drag work already deferred once in `redesign-plan.md` phase 5.
Order persists per user.

**5. The ⓘ opens the rail, not a popover** (§6.3). This removes the clipping problem
that a popover inside the scroll container would otherwise force — no portal, no
floating library, no placement maths.

---

## 8. SEO

### 8.1 The opening

Every major competitor either buries definitions in one monolithic glossary page
(PlayerProfiler, Pro Football Reference, Next Gen Stats) or publishes them as dated
blog posts that decay (FantasyPros `/2023/06/...`, RotoViz). **Nobody pairs an
evergreen, individually-indexed metric page with a live leaderboard for that metric.**
PlayerProfiler doesn't even link the metric labels on its player pages to its own
glossary. That gap is the strategy.

### 8.2 Target intents

- **Definitional, softest competition** — "what is target share", "what is WOPR", "what is a good aDOT". The "what is a good ___" variants are especially open because almost nobody publishes distribution context, and we will have the data to answer precisely.
- **Leaderboard, currently served by prose** — "target share leaders 2026", "air yards leaders". Beating an article with a real sortable table is a content-type mismatch in our favour, and it recurs weekly.
- **Conceptual, hard** — "fantasy football advanced stats". Hub and lesson targets only, not primary bets.
- **Commercial, small but high-intent** — "free advanced stats fantasy football", "PlayerProfiler alternative". Free-only launch is the differentiator here.

No search-volume figures appear in this spec because none were verifiable. Competitiveness above is qualitative.

### 8.3 The programmatic-content line

Google's spam policy on **scaled content abuse** turns on outcome, not method — AI,
template, or human authorship is irrelevant. Generating ~40 pages from one registry is
legitimate *if and only if* each page carries substance no template can fake.

**Binding requirements. A metric page may not ship unless it has all of:**

1. Live data — current leaders and a real distribution. **A page whose data payload is empty must not be published.** `planned` metrics render an explicit "not available yet, and here's why" page and stay out of the sitemap.
2. Distribution context — what a good value actually is, computed from our data, not asserted.
3. A worked example naming a real player.
4. Hand-written `whyItMatters` and `limitations` that are unique across the registry — enforced by test #8 in §4.4.
5. Unique title and meta description — no template with the name swapped in.

**Ship in waves of 10–15, not all at once**, with a human editorial pass per page.
Never auto-generate `<metric> × <team> × <week>` combinatorial pages.

### 8.4 Conversion, and the metering question

Chris raised a free-preview model: a few pages open, then an account required to
explore further. **The recommendation is to meter capability, not pages** — and the
reasoning matters, because the two look similar and behave very differently.

**Why not meter pages.** Part B's entire job is to be found by people who have never
heard of FieldScout. A page behind a counter can still be indexed — Google supports
it via `isAccessibleForFree: false` plus a `hasPart` block naming the gated selector —
but three things follow:

1. Serving Googlebot the full article while showing users a wall **without** that
   structured data is cloaking, and it's a policy violation, not a grey area.
2. Even done correctly, gated content competes at a disadvantage against the free
   equivalents already ranking (PlayerProfiler's glossary, PFR's, FantasyPros').
   We'd be entering a race carrying weight, for the one asset whose only purpose is
   to win that race.
3. It breaks the promise the homepage button just made. "Free guide" followed by a
   wall on page four is the kind of thing that costs more trust than it converts.

**What to gate instead.** The wall goes where the user stops *reading* and starts
*doing* — which costs nothing in search, because there's no prose behind it:

| Free, always | Account required |
|---|---|
| Every guide page, every lesson, end to end | **Saving** anything — a list, a filter preset, a comparison |
| Every metric definition, formula, limitation, stability figure | Custom weightings and personal scoring |
| Top 25 of any leaderboard, sortable and filterable | The **full** leaderboard beyond 25, and CSV export |
| Distribution context and worked examples | Following a player, alerts on role changes |
| — | Applying a metric across **your league's** rosters |

That last row is the real conversion engine. "See this for the players actually on
your roster" is a far stronger ask than "read more", it arrives at genuine peak
intent, and it's the natural bridge from Part B into Part A.

**Mechanics:**
- "Save these 24 WRs as a list" on a leaderboard — highest-intent moment on the page, lands directly in the existing Lists feature.
- Star a player — first is free, the prompt comes on the second or third.
- Sticky footer CTA after ~60% scroll. **Never a modal on load; never an interstitial** (mobile interstitial penalty).
- **Never truncate prose behind a wall.** Truncating rows 26+ of a table is fine; truncating a paragraph is not.

If Chris still wants page metering after this, it is implementable — but it needs
`isAccessibleForFree` structured data on every gated page, and it should be measured
against a free control group before it goes global. Recorded as open question #6.

---

## 9. States

Not optional, and not left to the implementer (CLAUDE.md → Prototype gaps):

| State | Behaviour |
|---|---|
| **Loading** | Skeletons matching final layout. Never a spinner on a full page. |
| **Empty (no qualified players)** | Explain the threshold: "No WR has 50+ targets yet in 2026." Not "No data." |
| **Below qualification** | `—` plus a tooltip naming the threshold. Never a misleading small-sample number. |
| **Planned metric** | Explicit page: what it is, why we can't show it yet, what would change that. Excluded from sitemap. |
| **Metric with no evidence** | Stability chip reads `unknown`. No fabricated figure. |
| **Preseason / week 0** | Fall back to the prior completed season, labelled with the season everywhere. |
| **Sync failure / stale** | Serve last good data with a visible "as of <date>" stamp. Never a blank page. |
| **Logged out** | Full content. CTAs present, nothing hidden. |
| **Mobile** | Tooltips become sheets. Leaderboards scroll horizontally with a frozen name column. |

---

## 10. Non-goals for v1

Explicitly out of scope. Each is a future spec, not a stretch goal:

- ~~**Composite grades**~~ — **lifted in v1.7, scope narrowed. See §16.** Scouting-trait grades (Route Running, Hands, Separation) stay out: they need routes data we can't buy, or they'd be assembled from the weakest predictors in the registry. A trait model over the *predictive* axes is defensible and is now specified.
- ~~**Build-your-own-model weight sliders.**~~ — **lifted in v1.7 (§16.4).** It was the right feature in the wrong order; the trait model is the layer it needed.
- **Player similarity / embeddings.** Needs a stable metric vector first, which is M2's output at the earliest.
- **College and prospect metrics** (Breakout Age, College Dominator, RAS). Different data source (collegefootballdata.com, RAS), different ID crosswalk, different sync. Its own spec.
- **Time machine / historical re-rank.**
- **AI natural-language metric queries.** Fold into `spec-ask-ai.md` once the registry exists — the registry is what makes it possible.

---

## 11. Business rules

1. **Scout's written content is free, forever, in full.** No `is_pro` gate and no signup wall on any prose, definition, formula, lesson or stability figure — logged out, end to end. Interactive depth (saving, full leaderboards, custom weightings, league-aware views) may require a free account; **none of it may require Pro.** Scout is the acquisition surface, and pricing it defeats its purpose. (Consistent with the Pro suspension in CLAUDE.md.)
2. **Metric definitions are read-only application data.** Users never edit them; they ship in code and change via PR.
3. **`player_metrics` is read-only player data.** Populated by sync only, exactly like `players` and `player_stats`.
4. **Attribution is mandatory** on every surface rendering nflverse-derived data.
5. **No metric ships without a source and a limitation.** Both fields are required by test #6.
6. **No fabricated statistics.** A missing correlation renders as absent, never as a plausible-looking number.
7. **Slugs and keys are permanent.** A slug is a public URL; changing one requires a 301 and a spec change.

---

## 12. Open questions for Chris

Answer before M1 starts; M0 is unblocked.

1. **Tier 2 legal read.** Do you want counsel on NGS/PFR redistribution before M6, or do we ship Tier 1 only for 2026 and revisit? *Recommendation: Tier 1 only for launch. It's enough, and it's clean.*
2. ~~**In-app placement.**~~ **Answered 2026-08-07 (Chris):** Scout is two parts —
   advanced data woven into the existing product (Part A), and a standalone mini-app
   launched from a homepage button into its own tab (Part B). No in-app tab. See §1, §6.0, §6.2.
3. **Lesson authorship.** Are you writing the five launch lessons, or do you want drafts to edit? They carry the brand voice, so they should sound like you.
4. **Historical depth.** How many seasons back should `player_metrics` load? *Recommendation: 2019 onward — five seasons is enough for trend lines and keeps the first sync manageable.*
5. **`/scout` vs `/stats` as the public path.** `/scout` is brandable and matches the product word; `/stats` is marginally more literal for search. *Recommendation: `/scout`. Brand beats a marginal keyword match, and the metric slug carries the keyword anyway.*

6. **Page metering.** Do you still want a hard "N free pages, then sign up" wall on
   Part B? *Recommendation: no — meter capability instead (§8.4). If yes, it needs
   `isAccessibleForFree` structured data and an A/B against a free control before
   going global.*

8. **Rank chip radius.** The library node uses ~3px on rank chips; the global rule is
   1px on everything (§7). Match the library, or conform? *Recommendation: match the
   library and add the carve-out to the design system alongside the existing
   avatars/dots exception — the chips read as pills, and a 1px chip next to a round
   rank badge looks like a bug rather than a choice.*

7. **The article engine (§14).** Do future insight articles come from the existing
   persona engine, a new hand-written editorial surface, or both? Not needed for
   launch, but it decides whether M5 wires the registry into `lib/personas/context.ts`.
   *Recommendation: build the citation contract now (§14), decide the source later —
   it costs nothing to keep both doors open.*

---

## 16. The trait model — Scout grade

### 16.1 What was cut from the original concept, and why

The originating brief graded scouting traits: Route Running, Hands, Separation,
Contested, YAC, Explosiveness. Mapped against data we can actually obtain:

| Trait | Needs | Reality |
|---|---|---|
| Route Running | YPRR, route win rate, man/press win rate, open % | **Every input needs routes run.** Unavailable at any price we pay today (§2.1) |
| Hands | drop rate, contested catch rate, catch rate | drop rate **r 0.14**, contested catch **r 0.02**, catch rate **R² 0.098** |
| Separation | NGS separation | Tier 2, and near-zero fantasy signal |
| YAC | YAC over expected | Tier 2, repeats at about r² 0.17 |
| Contested | contested catch rate | Paid, **r 0.02** — the weakest number in the whole research set |
| Explosiveness | breakaway rate, combine | Partly available, weak |

Not one is fully buildable, and the buildable parts are made of the worst-predicting
metrics we have. **A "Hands: 97" assembled from r 0.14 and r 0.02 inputs would
contradict every other page in Scout.** That is why §10 cut it.

### 16.2 What we grade instead

Grade the axes that move fantasy points, in fantasy language, not scouting language.

| Trait | Question it answers | Kind |
|---|---|---|
| **Workload** | How much of this offense is his? | grade |
| **Territory** | Where on the field does he get the ball? | grade |
| **Efficiency** | What does he do with the chances? | grade, low confidence |
| **Finishing luck** | Did the scoring match the chances? | **flag** |
| **Availability** | Did he stay on the field? | **flag** |

Position variants for RB and QB in `scout-content/traits.ts`.

### 16.3 The three rules that make it honest

1. **Default weights are derived, not chosen.** A metric's weight inside its trait comes from its published year-over-year stability. The model's only opinion is "trust what repeats" — which is testable, and is the same argument the rest of the guide makes. Hand-tuning a weight requires a written reason.
2. **Every grade shows its receipts.** Opening a trait lists its metrics, their percentiles and their weights. No unfalsifiable number anywhere.
3. **Flags are never graded.** Finishing luck and availability are reported and never scored into the composite. **A player in the 95th percentile of touchdown luck is not better — he is more expensive.** Scoring him higher for it would invert the advice the whole product gives.

Two further rules from `traits.ts`:

- A trait returns **null**, not a number, when under half its input weight is present. A grade built on one of three inputs is not a grade (§9).
- Weights renormalise over the inputs that qualified, so a player missing one metric isn't silently penalised.

### 16.4 Build your own model

Sliders over trait weights, re-ranking the board live. The default position is the
evidence-derived model; a user can disagree, and moving a slider shows exactly how
much their opinion costs or gains each player.

This is the feature the original brief was most excited about, and it only became
possible once traits existed — which is why §10 sequenced it after the metric layer
rather than dropping it.

**Guardrail:** raising a low-confidence trait must surface its caveat, not hide it.
The user is allowed to weight efficiency at 90%. They are not allowed to do it
without being told efficiency barely repeats.

### 16.5 Not in this model

Player similarity, positional scarcity, and any grade that blends across positions.
A WR's 82 and a RB's 82 mean "82nd percentile among his own position" and nothing more —
**the composite is never comparable across positions** and the UI must not imply it is.

---

## 14. Scout as the citation layer *(forward-looking)*

Chris's stated end state: push out insight articles that drive traffic back to Scout,
with Scout as **the resource those articles are derived from**. That inverts the usual
SEO model in a useful way — the articles earn the links and shares, and every one of
them points at the evergreen pages, which is what builds Scout's authority over time.
It also defuses the thin-content risk in §8.3, because the editorial weight lives in
the articles rather than in 40 templated pages.

For that to work, two things must be true from M0, and both are cheap now and
expensive to retrofit:

1. **The registry is the single source of every number that appears in an article.**
   An article that hardcodes "target share R² is 0.40" will drift the moment the
   registry is corrected. Articles read the registry — no second copy of a figure,
   anywhere. This is §4.4 test #8 extended past the registry's own boundary.
2. **Every claim is addressable.** Each metric page section gets a stable anchor
   (`/scout/target-share#stability`, `#limitations`, `#distribution`) so an article
   can cite the exact claim rather than the page. Anchors are public URLs and are
   permanent, same rule as slugs (§11.7).

If the existing persona engine becomes the source (open question #7), the integration
point is `lib/personas/context.ts` — the registry joins the packet the personas are
already given, so generated posts cite real values and link to real pages. That
engine is currently flag-gated out of the 2026 launch scope; **nothing in Part A or
Part B may depend on it being un-gated.**

---

## 13. Definition of Done

Per the redraft-leagues convention (delivery plan §2.3), every Scout task lands with:

- Tests green — **shown, not claimed**. Registry integrity tests pass.
- `npm run type-check` and `npm run lint` clean.
- Schema/RLS work verified: anon can read, authenticated cannot write.
- `PROGRESS-scout.md` updated.
- A small commit citing the spec §.
- **Branch + PR. Never a direct commit to main. One task, one PR.**

---

## Changelog

- **v1.7** — **Trait model added (§16), lifting two §10 non-goals.** Composite grades
  return with the scope narrowed to axes the data supports — Workload, Territory,
  Efficiency — with finishing luck and availability as flags that are reported but
  never scored, because a player in the 95th percentile of touchdown luck is expensive,
  not good. Default weights derive from published stability rather than opinion, and
  every grade shows its inputs. Build-your-own-model sliders lifted with it. Scouting
  traits (Route Running, Hands, Separation) stay cut, with the data reasons tabulated.
- **v1.6** — Full guide IA built out (§6.1). The guide is **a five-lesson path over a
  browsable reference**: numbered lessons for anyone arriving from the homepage button,
  standalone metric / leaderboard / position pages for anyone arriving from search.
  Adds two rules: every lesson ends in an action with a button to the leaderboard that
  performs it, and leaderboards carry a `buy` chip where role rank leads scoring rank —
  which is what makes the guide a tool rather than an article. Position pages rank every
  metric by stability with an explicit "below here it's mostly luck" divider.
- **v1.5** — **Tooltips removed** (Chris, 2026-08-07). The ⓘ is a click target that opens
  the metric in the existing `ResearchRail` panel (§6.3 rewritten): no hover misfires on a
  16-column table, no scroll-container clipping, and the explainer stays open while you
  scan. `useRailStore` gains a contextual `metric` tool. Table type scale drops again
  (36px rows, 12px values) and §7.1 now mandates **mono tabular numerals at regular
  weight** — a column of bold is a wall, and emphasis belongs to the rank chip.
- **v1.4** — Content rewrite (Chris, 2026-08-07). **"This, not that" becomes the primary
  content format**, and the swap card the canonical unit — the hub is a grid of them and
  metric pages lead with one. Registry copy fields restructured (`plain`, `impact`,
  `insteadOf`, `watchOut`) with hard character ceilings enforced by test (§4.4 #7), and
  new §4.5 sets voice: fantasy consequence over definition, no jargon, no formulas in
  hovers. Stat cards promoted to a first-class rendering of a registry entry.
- **v1.3** — Adds §7.2, table interactions, bound to library node `62:484`: frozen
  headers on both axes, row+column crosshair highlight, axis transpose, and drag-to-
  reorder for stat groups. Tightens the §7.1 type scale one step (44px rows). Notes the
  tooltip-clipping constraint the prototype surfaced.
- **v1.2** — Adds §7.1, the stat table pattern, bound to FieldScout Library node
  `75:743`: two-tier group header, ⓘ tooltip trigger on every column header, and a
  value-plus-positional-rank-chip cell with the library's four-step tier ramp. Advanced
  metrics land under the **Pro Metrics** group. Adds open question #8 (rank chip radius).
- **v1.1** — Restructured around Chris's two-part model (2026-08-07): **Part A**, advanced
  data woven into the existing product, and **Part B**, a standalone mini-app launched
  from a homepage button into its own tab. Kills the in-app tab (v1.0 §6.2) and answers
  open question #2. Adds §6.0 (homepage entry point), §14 (Scout as the citation layer
  for future articles), and open questions #6–7. Rewrites §8.4 to recommend metering
  **capability rather than pages**, and softens business rule #1 accordingly — prose stays
  free and ungated, interactive depth may need a free account, nothing needs Pro.
- **v1.0** — Initial spec. Scope set by Chris 2026-08-07: nflverse now / paid later, public SSR + in-app tab, registry + Scout surface + profile panels all in scope as part of Stats/research. Corrects the originating brief's assumption that routes-run-derived metrics (YPRR, TPRR) are freely available — they are not, and are specified as `planned` stubs.

## Sources

- [nflreadr reference index](https://nflreadr.nflverse.com/reference/index.html) · [NGS dictionary](https://nflreadr.nflverse.com/articles/dictionary_nextgen_stats.html) · [participation dictionary](https://nflreadr.nflverse.com/articles/dictionary_participation.html) · [nflverse data schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html) · [nflreadpy (licensing)](https://github.com/nflverse/nflreadpy)
- [Sharp Football — WR stats that matter](https://www.sharpfootballanalysis.com/fantasy/wide-receiver-stats-that-matter-fantasy-football-2024/) · [RB](https://www.sharpfootballanalysis.com/fantasy/running-back-stats-that-matter-fantasy-football-2024/) · [TE](https://www.sharpfootballanalysis.com/fantasy/te-stats-that-matter-fantasy-football/)
- [4for4 — most predictable WR stats](https://www.4for4.com/2024/preseason/most-predictable-wide-receiver-stats) · [SumerSports — sticky football stats](https://sumersports.com/the-zone/sticky-football-stats-predictive-nfl-metrics/) · [Fantasy Classroom — WR sticky stats](https://fantasyclassroom.org/Blogs/sticky-stats/wr-sticky-season-totals)
- [PFF — yards per route run](https://www.pff.com/news/fantasy-football-metrics-that-matter-yards-per-route-run) · [nfelo — CPOE, RYOE, YACOE](https://www.nfeloapp.com/analysis/over-expected-explained-what-are-cpoe-ryoe-and-yacoe/) · [Fantasy Points — xTD regression](https://www.fantasypoints.com/nfl/articles/2023/xtd-touchdown-regression-candidates)
- [Google spam policies — scaled content abuse](https://developers.google.com/search/docs/essentials/spam-policies) · [Google structured data gallery](https://developers.google.com/search/docs/appearance/structured-data/search-gallery) · [Google drops FAQ rich results](https://www.searchenginejournal.com/google-drops-faq-rich-results-from-search/574429/)
- [PlayerProfiler glossary](https://www.playerprofiler.com/terms-glossary/) · [FantasyPros glossary hub](https://www.fantasypros.com/fantasy-football-deep-stat-analysis-glossary-guide/) · [Pro Football Reference glossary](https://www.pro-football-reference.com/about/glossary.htm)
