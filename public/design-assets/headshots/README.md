# Sample player headshots (design prototyping)

50 NFL headshots for mockups and prototypes — **not** a runtime data source.
The app should keep reading `players.headshot_url` from Supabase.

Mix: 8 QB · 12 RB · 18 WR · 8 TE · 4 K, drawn from the top ~170 by 2026 PPR
projection. Copied from `player thumbnail headshots/` (originally pulled from
Sleeper via `scripts/download-top300-headshots.ts`).

## Two ways to use these

**1. Claude Design / claude.ai prototypes → use the CDN URLs.**
Claude Design runs in the browser and cannot read this repo, so point it at
Sleeper directly. Paste `sample-players.js` into the prototype (or just the
`headshot()` helper):

```js
import { SAMPLE_PLAYERS, headshot } from './sample-players'

<img src={headshot(player.id)} alt={player.name} />        // ~100px thumb
<img src={headshot(player.id, 'full')} alt={player.name} /> // ~400px
```

URL shape: `https://sleepercdn.com/content/nfl/players/thumb/{sleeperId}.jpg`

**2. Local Next.js prototypes → use the files in this folder.**
They're under `public/`, so they're served at:

```
/design-assets/headshots/josh-allen-qb.jpg
```

Each entry in `sample-players.json` carries a `local` field with that path.

## Files

| File | What it is |
| --- | --- |
| `*.jpg` | 50 headshots, web-safe slugs (`first-last-pos.jpg`) |
| `sample-players.json` | rank, sleeperId, name, team, position, file, thumb, full |
| `sample-players.js` | drop-in ES module + `headshot(id, size)` helper |
| `contact-sheet.html` | open in a browser to eyeball all 50 |

## Notes

- These are Sleeper JPGs **with backgrounds**, not cutouts. Per
  `.claude/skills/design-fidelity/SKILL.md`, don't chase cutout-dependent
  effects in mocks.
- Rosters change. Regenerate with
  `npx tsx scripts/download-top300-headshots.ts`, then re-run the curation.
