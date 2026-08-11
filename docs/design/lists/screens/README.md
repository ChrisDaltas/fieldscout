# Lists v2 — prototype screenshots

**These images are the fidelity reference. They outrank the prose.**

`../README.md` is the handoff's written spec. It is useful for exact values —
colors, pixel sizes, control heights — but it has been wrong at least once in a
way that shipped: it describes the tier ramp as *"indigo"* when the design (and
the app's own `tier-*` tokens) run red → orange → gold → green → teal. LV.2 was
built to the sentence and had to be scrapped.

So the rule, recorded in `PROGRESS-lists-v2.md` §7: **where these screenshots
and the prose disagree, the screenshots win.** Where the screenshots and
`tailwind.config.ts` agree with each other and the prose doesn't, that is
settled — implement from the tokens.

## What belongs here

One image per mode, named for the mode:

| File | Shows |
| --- | --- |
| `list-rail.png` | List mode — the rail plus the **open list** filling the right panel |
| `cards.png` | Cards mode — the gallery of list cards |
| `side-by-side.png` | Side by side — the compare columns with drafted checkboxes |
| `side-by-side-picker.png` | Side by side — "Pick the lists to compare" |
| `detail-cards.png` | List mode with the detail's **Cards** view style |
| `detail-table.png` | List mode with the detail's **Table** view style |

Anything else useful (hover states, empty states, mobile widths) is welcome —
name it for what it shows.

## Why this folder exists

The Claude Design package shipped a prose spec and four `.jsx` files with **no
images**, and it omitted `index.html` and `players.js`, so the prototype could
not be run locally either. Everything built before these landed was built from
a written description of a screen nobody involved had seen.
