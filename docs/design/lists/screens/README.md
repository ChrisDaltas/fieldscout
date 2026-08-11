# Lists v2 — prototype screenshots

**These images are the fidelity reference. They outrank the prose.**

`../README.md` is the handoff's written spec. It is useful for exact values, but
it has been wrong in ways that shipped — it calls the tier ramp *"indigo"* when
the design (and the app's own `tier-*` tokens) run red → orange → gold → green
→ teal. LV.2 was built to the sentence and had to be scrapped.

So: **where these screenshots and the prose disagree, the screenshots win.**
Where the screenshots and `tailwind.config.ts` agree and the prose doesn't,
that's settled — implement from the tokens.

## Index

| File | Shows |
| --- | --- |
| `list-rail-list-view.png` | **List page mode** — rail + the open list, detail in **List** view style |
| `list-rail-table-view.png` | Same, detail in **Table** view style |
| `list-rail-cards-view.png` | Same, detail in **Cards** view style |
| `cards-gallery.png` | **Cards page mode** — the gallery of list cards |
| `side-by-side-picker.png` | **Side by side** — "Pick the lists to compare" |
| `side-by-side-columns.png` | **Side by side** — the compare columns, drafted checkboxes, tier bands |
| `detail-table-ranked.png` | Detail, Table view, **Ranked** grouping, full stat set (ADP · Cost PPR · Proj · Bye · SOS) |
| `detail-table-ranked-alt.png` | As above, second capture |
| `detail-grouping-rounds.png` | Detail grouped by **Rounds** |
| `detail-grouping-avg-cost.png` | Detail grouped by **Avg cost** — band label being edited inline |
| `detail-grouping-budget-pct.png` | Detail grouped by **Budget %** — share-of-budget bars |
| `detail-note-hover-card.png` | A player note rendered as a hover card |
| `detail-tab-details.png` | The **Details** tab — tags, description, attached links, position mix |
| `detail-tab-comments.png` | The **Comments** tab |

**Only Field Scout prototype screens belong here.** A competitor capture was
filed here in error on 2026-08-10 and removed the same day.

## ⚠️ These corrected the delivery plan (2026-08-10)

Read together with `PROGRESS-lists-v2.md`. The screenshots falsified four
decisions that were made from the prose alone:

1. **Budget grouping renders, and well.** `detail-grouping-budget-pct.png`
   shows a *Share of budget* column — a filled bar plus a percentage per player,
   with bucket headers "Over 20% of budget" / "10–20%". PROGRESS said *"nothing
   can render it… budget grouping is not in Round 1."* **That was wrong.**
2. **Per-player cost exists — as a stat, not a bucket.** `Cost PPR` is a
   selectable stat column (`$55`, `$63`, `$68`…). Budget % is computed from it.
   Plan D4's *"there is no separate round or cost field, nothing is computed"*
   holds for **bucket membership** and is wrong about **stats**.
3. **`links[]` is not dropped.** `detail-tab-details.png` renders an
   **Attached links** section with a YouTube video (title, source, duration,
   remove control) and an "Attach a video or article" action. Plan §2.2 listed
   it as *"Dropped — the handoff defines them but never renders them."*
4. **Cost band labels are edited inline in the header**, mid-list — see the
   `$40 and up` field in `detail-grouping-avg-cost.png`. Bucket headers also
   carry a running total (`$773`) and an `Add +` affordance on the right.

Also confirmed from the images: the grouping control reads **Ranked · Rounds ·
Avg cost · Budget %** (plus Tiers), and cover tiles are solid saturated blocks
with large initials or a glyph — not the existing `ListThumbnail` headshot grid.

## Why this folder exists

The Claude Design package shipped a prose spec and four `.jsx` files with **no
images**, and omitted `index.html` and `players.js`, so the prototype could not
be run locally either. Everything built before these landed was built from a
written description of a screen nobody involved had seen.
