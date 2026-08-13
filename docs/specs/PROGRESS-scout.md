# PROGRESS — Scout

> **The build loop's only memory for this build.** Re-read at the start of
> every cycle; never rely on chat history. Every cycle ends at a task boundary
> with this file current, so a session can be compacted or killed at any point
> and a fresh one resumes losslessly.
>
> **Authority:** spec (`docs/specs/spec-scout.md` v2.7) > delivery plan
> (`docs/specs/delivery-plan-scout.md` v2.7) > this file.
>
> **Not yet in `ACTIVE-BUILD.md`.** Scout is specced and prototyped; no code has
> been written into the app. Lists v2 (`LV.*`) is the active build — never pick
> a Scout task while that is true.

---

## 1. Phase status

| Phase | Contents | Status |
| --- | --- | --- |
| **1 — Rankings** | `player_metrics` table + sync, evidence-derived weights, the board with nested levers and one league lever per position | ⚪ Not started. Blocked on nothing but sequencing. |
| **2 — Player detail** | Advanced tab, percentile bars, weekly chart, Scout grade, rail explainer, stat-center columns | ⚪ Not started |
| **3 — The Guide** | `/scout` three-page path + leaves + SEO plumbing | ⚪ Not started |

**Design and content are done. What remains is wiring.** The registry, trait
model, position guides and lesson copy are written and checked into
`docs/specs/scout-content/`. Phases 1–3 move them into `src/lib/metrics/` and
build routes around them — they do not re-decide any of it.

---

## 2. What is settled (do not re-litigate)

- **Three surfaces, not one app.** Rankings (needs an account), player detail
  (needs an account, it's the app), the Guide (no account). Spec §1.
- **Scout is entirely free.** No paid tier, no `is_pro` gate, ever. The only
  line is signed out vs. signed in. Say "Account?", never "Free?". Spec §1.
- **The Guide is a three-page path**: landing → position → rankings. Everything
  else is a leaf. Spec §6.1.
- **The corridor is visible, not just walkable** — the step rail with
  done / current / locked states, on all three path pages. Spec §6.1. Added v2.7
  after the prototype proved that working links alone don't make a path legible.
- **Explainers open on click, into the existing right rail.** No hover
  tooltips. Spec §6.3.
- **Levers nest.** Trait sliders set share-of-grade; metric sliders renormalise
  inside a trait. Flat sliders silently shift the weighting. Spec §16.5.
- **One league lever per position** — points per reception at WR/TE/RB, points
  per passing TD at QB. Swapped, never disabled. Spec §16.6.
- **Traits are fantasy-predictive axes, not scouting traits.** Opportunity /
  target quality / efficiency, plus flags that report and never score. The
  ChatGPT-era "Hands / Route Running / Separation" model is dead: it is either
  unbuildable on free data or assembled from the registry's worst predictors.
  Spec §16.
- **Routes run is unobtainable on free data**, which kills YPRR, TPRR and route
  participation. Do not spec around them. Spec §2.
- **Tier 1 sources only.** No NGS, no PFR, no FTN, nothing paid — the legal read
  on Tier 2 is still open. Spec §2.

---

## 3. Verified in the prototype

`fieldscout-scout-prototype.html` — front-end only, deliberately **not in this
repo** (spec process constraint). Ten screens: the three path pages, four
reference leaves, and the two in-app surfaces.

Checked by automated pass, not by eye:

- Homepage → landing → position → rankings walks with **in-page links only**,
  zero debug-nav clicks.
- Step rail shows exactly one `current` step per page, correct `done` set, and
  step 3 `locked` until the unlock.
- Every `done` step links back.
- Stat-center table: horizontal scroll live (`width: max-content`), frozen
  columns hold under an explicit six-layer stacking order, rail panel opens and
  closes.
- Weekly chart palette validated — CVD ΔE 46.6, every mark ≥ 3:1 contrast.
- Locked regions contain **placeholder shapes only**; no real metric value ships
  in the gated DOM (the cloaking risk in spec §8.5).

---

## 4. Open, and blocking

| # | Question | Blocks | Owner |
| --- | --- | --- | --- |
| 1 | **Worked examples for RB, TE and QB.** WR has four verified cases; the other three positions have none. Spec §3.1 forbids inventing one. | Those three position pages | Research |
| 2 | **Relevance backtest.** Lever weights are `stability × relevance(ppr)`. The stability half is sourced; the relevance half is not yet computed. Until it is, offer **half-PPR only** — a gate refuses un-backtested steps. | The PPR lever's other steps | Phase 1b |
| 3 | **Default metric weights are still literals** in `scout-content/traits.ts`. The plan requires them computed from `stabilityEvidence`, verified by test. | Phase 1 gate | Phase 1b |
| 4 | **Tier 2 legal read** (NGS / PFR). nflverse's grant can't license the underlying NFL/PFR rights. | Any NGS or PFR metric | Chris |

None of these block starting Phase 1a (the table and the sync) — that is Tier 1
only and fully specified.

---

## 5. Known gaps in the prototype

Cosmetic or scope, not decisions — carry them into the build, don't fix the
artifact:

- Seven dead links on the guide screens (three non-WR position cards, "The
  guide", "Create free account" ×2, "Positions").
- RB / TE / QB position pages render the WR structure with placeholder cases,
  pending open question #1.
- Lever relevance weights on the board are illustrative, pending #2.

---

## 6. Log

- **2026-08-12** — Spec and plan to **v2.7**: the step rail. Chris's read after
  walking the prototype was that it was still unclear how you move through the
  guide, and he was right — the links all worked, but no page said where you
  were. Rail specced with done / current / locked states, five navigation gates
  added to the Phase 3 gate, prototype rebuilt and re-verified. This file
  created; the spec and plan had both referenced it since v2.0 and it had never
  existed.
- **2026-08-11** — Guide restructured to the **three-page path** (v2.5), then
  the weekly chart (v2.6). The five-lesson curriculum collapsed into the
  position pages.
- **2026-08-11** — Trait model, nested levers, league lever per position, and
  the public-player-page partial reveal settled (v2.1–v2.4).
- **2026-08-10** — Spec, delivery plan and `scout-content/` first written.
