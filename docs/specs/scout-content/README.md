# Scout content bundle

Authored content for the Scout feature. Spec: `../spec-scout.md`, plan: `../delivery-plan-scout.md`.

| File | What it is | Where it lands |
|---|---|---|
| `types.ts` | `MetricDefinition` and its unions | `src/lib/metrics/types.ts` |
| `registry.ts` | **35 metrics** — 29 live, 6 planned | `src/lib/metrics/registry.ts` |
| `positions.ts` | Four position guides | `src/lib/metrics/positions.ts` |
| `lessons.md` | The five lessons, for you to edit | `src/content/scout/lessons/*.mdx` |

These live in `docs/specs/` on purpose. They are **content, not committed code** — the
M0 PR moves them into `src/` (CLAUDE.md: branch + PR, never a direct commit to main).

## Validated

Run against the §4.4 rules before this was written down:

- Copy ceilings hold — `plain` ≤110, `impact` ≤160, `because` ≤180, `watchOut` ≤140
- No sentence over 20 words in `plain` or `impact` (§4.5 rule 6)
- Slugs and keys unique; every `related` and every position-guide slug resolves
- No duplicated `plain` or `impact` copy (the §8.3 thin-content guard)
- Every `licenseTier >= 2` entry is `status: 'planned'` — nothing gated ships live

## Two things that need your call

**1. The symmetry rule was wrong, and running it proved it.** Spec §4.4 #3 demanded
hand-written symmetric `related` arrays. Enforcing it gave `target-share` eleven
back-references — "Related metrics" with eleven entries is a sitemap, not a
recommendation. `registry.ts` now computes the symmetric closure and `relatedFor()`
caps and sorts it. **Spec §4.4 #3 needs updating to match.**

**2. Two figures are ordering-only, not printable.** Goal-line carry share and route
participation have no published year-over-year figure I could verify. They sort
correctly in the position guides but their registry `stabilityEvidence` is `null`, so
the UI must render them with no number (§3.1). `UNSOURCED_ORDERING_ONLY` in
`positions.ts` names them.

## What's still yours

The five lessons are drafted but they're **the most brand-visible writing in the
product** — they should sound like you, not like me. The registry copy is tighter and
more mechanical; it needs a read-through, not a rewrite.

Lesson 4 (rookies) teaches dominator rating and breakout age but ships **no data** —
those come from collegefootballdata.com, which spec §10 lists as a non-goal for v1.
