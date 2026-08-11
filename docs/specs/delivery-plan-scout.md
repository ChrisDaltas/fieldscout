# Delivery plan: Scout

**Spec (LAW):** `docs/specs/spec-scout.md` (v2.5)
**Content, already written:** `docs/specs/scout-content/` — registry, traits, positions, lessons
**Progress/memory:** `docs/specs/PROGRESS-scout.md`
**Version:** v2.5

---

## The whole thing in one table

| Phase | You get | Account? |
|---|---|---|
| **1 — Rankings** | A board per position with levers. Move Opportunity up, touchdowns down, get your own rankings. | Needs one |
| **2 — Player detail** | Advanced metrics with percentile context on the in-app player page. | Needs one |
| **3 — The Guide** | `/scout` — launch page + a guide per position, explaining why the levers are what they are. | No |

**Scout is entirely free — no paid tier, no `is_pro` gate, ever.** The only line is
signed out vs. signed in.

**Phase 1 is the product. Phase 3 is the marketing for it. Phase 2 is the depth behind
both.** Ship in that order: build the thing, make it deep, then go get traffic for it.

Everything below already has its content written. These phases are wiring, not design.

---

## Phase 1 — Scout AI rankings

**The differentiated thing.** Nobody else lets a casual player re-weight a ranking on
axes they understand and see the board move.

### 1a. Data (the only real risk in the plan)

- `supabase/migrations/0XX_player_metrics.sql` — narrow table, RLS anon-read / no authenticated write, indexes, `player_metrics_season` materialized view (spec §5).
- `scripts/sync-advanced-metrics.py` — modelled on the existing `load-historical-stats.py`.
  - Build against **`stats_player`**, not the deprecated `player_stats` release (spec §2.3).
  - Tier 1 only: `stats_player` (target share, air yards share, WOPR, RACR, receiving EPA, CPOE), `load_pbp` (aDOT, red zone share), `load_ff_opportunity` (expected points, expected TDs).
  - ID crosswalk `gsis_id → sleeper_id`. **Expect nulls.** Log unmatched counts; never silently drop.
- Percentiles computed at query time, within position + season, over the qualified population only.

### 1b. The model

- `src/lib/metrics/` — `types.ts`, `registry.ts`, `traits.ts`. **Already written** in `scout-content/`; this is a move plus a test file.
- **Derive the default weights: `stability × relevance(ppr)`** (spec §16.6), not my hand-set numbers. A metric with `null` stability evidence gets no weight and is excluded.
- **Backtest the relevance half.** Score historical player-seasons at each PPR step using the existing `PPR_SCORING` / `HALF_PPR_SCORING` / `STANDARD_SCORING` rules, then correlate each metric to **next-season** points at that setting. **If the backtest isn't ready, ship half-PPR only and say so** — three formats with invented weights is worse than one with real ones.

### 1c. The board

- Ranking board per position. Default levers = the evidence-derived model.
- **Levers nest**: trait sliders set share-of-grade, metric sliders renormalise inside a trait (spec §16.5). Three sliders visible, nine on request.
- **One league lever per position**, in a separate **"Your league"** zone above the model levers — a league rule, not a preference (spec §16.6). WR/TE/RB: **points per reception**, 0 → 1 in .25 steps. QB: **points per passing TD**, 4 / 5 / 6. Reads from the user's saved scoring system when signed in.
- Flags (finishing luck, availability) render but never score.
- Signed out: the board renders with default levers. **Moving a lever prompts signup.** Feel it, then join.
- Saving a board, exporting, and applying levers to your league's rosters need an account.

**Gate:**
- [ ] Sync is idempotent; row and unmatched-ID counts reported per season per source
- [ ] Spot-check 10 known players against a public source
- [ ] Anon can `SELECT`, authenticated cannot write — pgTAP test in `supabase/tests/`
- [ ] **No Tier 2, 3 or 4 source touched** — verified by grep in the gate script
- [ ] `validateModels()` passes: graded weights sum to 1 per position, flags are 0, low-confidence traits carry a caveat
- [ ] Default metric weights are **computed from evidence**, not literals — verified by test
- [ ] Tuning a metric weight leaves its trait's share-of-grade unchanged
- [ ] A trait with under half its input weight present returns null, not a number
- [ ] Grades are never presented as comparable across positions (spec §16.6)
- [ ] Signed-out board renders; first lever move prompts signup
- [ ] Changing a league lever visibly re-ranks the board, and **re-baselines the move column** — verified by test
- [ ] PPR reads from the signed-in user's saved scoring system, not a hardcoded default
- [ ] Each position shows exactly one league lever, swapped not disabled — PPR never appears at QB, passing-TD never at WR
- [ ] Any lever step whose relevance weights aren't backtested is **not offered** — no invented weights (spec §3.1)

---

## Phase 2 — Player detail

- **Advanced tab** on the player page: percentile bars within position and season, over the qualified population only.
- **Opportunity vs. production** block — expected fantasy points against actual. The regression argument made concrete for this player.
- **Weekly trend sparkline** per metric — the role-change signal season averages hide.
- **Scout grade + trait breakdown** for this player, with receipts on expand.
- ⓘ on every metric label, opening the rail `MetricPanel` (spec §6.3). **No hover tooltips.**
- Stat center gets the advanced columns, the two-tier header and the crosshair (spec §7.1–7.2, library nodes `75:743` and `62:484`).

**Gate:**
- [ ] Percentiles computed over the qualified population only — fixture test where an unqualified player would otherwise distort the distribution
- [ ] Below-threshold values render `—`, never a number
- [ ] Rank chip buckets scale with league size (default 12, read from settings — **do not hardcode**)
- [ ] Every number renders mono + tabular at regular weight (spec §7.1)
- [ ] Frozen columns: explicit stacking order; `width: max-content` on the scroll container so horizontal scroll actually works
- [ ] Panel is keyboard accessible and persists across navigation; bottom sheet below `lg:`
- [ ] In-app player page requires an account, like the rest of the app

---

## Phase 3 — The Guide

Content is written. This is routes, templates and SEO plumbing.

- `ScoutShell` — its own header and footer. **Never imports the app shell.**
- Homepage button: *"Become a Field Scout"* → `/scout`, new tab, `variant="blue"` (spec §6.0).
**The path (build these first):**
- `/scout` — welcome, **one worked example**, four position cards.
- `/scout/<position>` × 4 — 3–4 swaps, each with a **one player / two seasons** example, ending in the unlock block.
- The unlock → account → rankings board.

**Leaves (after the path works):**
- `/scout/<metric>`, `/scout/<metric>/leaders`, long-form lesson pages.
- **Public player pages** (spec §8.5), top ~150 players. Three headline metrics open and indexed; the depth behind a *Create free account* overlay.
- **Every guide ends in its build CTA** — "now build your own WR board" — which is the signup moment (spec §8.4).
- `generateMetadata()` per route, per-metric OG images, `BreadcrumbList` + `DefinedTerm` JSON-LD. **No `FAQPage`.**
- `sitemap.ts` extended; `planned` metrics excluded.
- Stable section anchors (`#stability`, `#limitations`) so future articles can cite a claim, not a page (spec §14).

**Gate:**
- [ ] **Every word of every guide readable signed out** — verified by test, not by eye
- [ ] Primary content present in the initial HTML — verified with JS disabled
- [ ] No two pages share a title or meta description
- [ ] Every published metric page passes the §8.3 substance checklist; `planned` metrics excluded from the sitemap
- [ ] Every position page ends in the unlock block, linking to a working board
- [ ] **Every swap has a verified worked example** — RB, TE and QB cases must be found and checked before those pages ship. Never invent one (spec §3.1)
- [ ] A first-time visitor can get from the homepage button to the rankings in three clicks
- [ ] **No metric value appears in the gated DOM for an anonymous request** — verified by test. Placeholder shapes only; real values fetched after auth (spec §8.5)
- [ ] The open half of a public player page answers the query its title promises — the searched metric is never the blurred one
- [ ] `/scout` renders in `ScoutShell` with zero app-shell imports — verified by import graph
- [ ] Homepage button and `/scout` on the same flag
- [ ] Lighthouse SEO ≥ 95 on a position guide
- [ ] **Publish metric pages in waves of 10–15 with a human editorial pass**

---

## Flags

Two, so the halves release independently (`src/lib/feature-flags.ts` convention):

- `NEXT_PUBLIC_FLAG_SCOUT_RANKINGS` — phases 1 and 2.
- `NEXT_PUBLIC_FLAG_SCOUT_GUIDE` — phase 3, and the homepage button. Same flag, because a button that opens a 404 is worse than no button.

---

## Definition of Done

Per PR, no exceptions: tests green **shown not claimed** · `type-check` clean · `lint`
clean · pgTAP passes if schema changed · `PROGRESS-scout.md` updated · small commit
citing the spec § · **branch + PR, never a direct commit to main.**

---

## Risks

| Risk | Mitigation |
|---|---|
| **nflverse schema drift** (`player_stats` → `stats_player` already happened) | Build against new names, alias the old. Sync fails loudly on unexpected columns rather than writing nulls. |
| **ID crosswalk gaps** — rookies and practice-squad players lack `sleeper_id` | Expected and logged. Surface unmatched counts in the run summary. |
| **Levers become a toy** — users move sliders, get noise, lose trust | Defaults are evidence-derived and one click away. Low-confidence traits surface their caveat when raised. |
| **Lever relevance weights get hand-set under deadline pressure** | Spec §16.6 forbids it. Ship one step per position until the backtest exists; a gate blocks un-backtested steps from being offered. |
| **Grades read as authoritative** | Every grade shows its inputs. Flags never score. Never comparable across positions. |
| Metric pages read as thin | §8.3 is a binding gate. Waves of 10–15, human pass, no empty payloads. |
| Scope creep toward similarity / embeddings | Still a spec §10 non-goal. Needs a stable metric vector first. |

---

## Not in this plan

Player similarity, time machine, college and prospect metrics, AI natural-language
queries, Tier 2 data (NGS/PFR — blocked on the legal read, spec open question #1),
and any `is_pro` gate on Scout.

---

## Changelog

- **v2.5** — Phase 3 restructured to a **three-page path**; metric pages and leaderboards
  demoted to leaves. Adds a gate requiring a verified worked example per swap.
- **v2.4** — One league lever **per position**: PPR at WR/TE/RB, passing-TD value at QB.
- **v2.3** — Phase 1 gains the **PPR lever** and the relevance backtest (spec §16.6).
  Adds gates for re-baselining, reading the user's saved scoring system, hiding the
  lever at QB, and refusing to offer un-backtested PPR steps.
- **v2.2** — Vocabulary: Scout is entirely free, so the docs no longer say "free vs
  paid" anywhere. The only line is signed out vs. signed in.
- **v2.1** — In-app player detail correctly behind an account (it's the app). Phase 3 gains public
  player pages with a partial reveal, plus a test that no real value ships inside the
  locked region.
- **v2.0** — Collapsed from seven milestones to **three phases**, one per surface
  (spec v2.0). Rankings promoted to phase 1 — it's the product, not an M3 sub-feature.
  Gate moved to **build, not read**: all guides free and indexed, an account unlocks
  your board. Adds a gate requiring default metric weights to be *computed* from
  `stabilityEvidence` rather than shipped as literals.
- **v1.0–v1.8** — Superseded. Content and design decisions carried forward intact;
  only the sequencing and the gate changed.
