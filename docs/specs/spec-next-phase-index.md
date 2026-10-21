# FieldScout Next Phase — PRD Index

Oct 17, 2026 · @Chris

The four PRDs below are the current source of truth. The earlier Claude Code roadmap prompt is retired.

## Product thesis

Existing fantasy platforms reset every year and make fantasy feel like admin. FieldScout keeps your record, measures your skill and makes fantasy feel like a real game. Start with familiar standard leagues so commissioners can move their league over, then introduce new formats leagues can opt into.

## The PRDs

| PRD | What it covers |
| --- | --- |
| [Duel — Game Design & Build Spec](https://claude.ai/code/artifact/1528c000-415b-4ba9-8b25-c1a22473997e) | Head-to-head live game: Duel Live (one window, swaps; single-game pick-by-quarter) and Duel Week (four quarters per slot) |
| [Highlights & Watch — PRD](https://claude.ai/code/artifact/e5c2c903-8296-49a3-862d-3293b784c4ac) | YouTube highlight index, video on player and team pages, the Watch tab |
| [NFL Player Profiles — PRD](https://claude.ai/code/artifact/60bd47bf-55bf-45d6-a68b-68fe21259a1a) | Ranked claims, stat catalog, receipts, comparisons, share cards |
| [Manager Profiles & Versus — PRD](https://claude.ai/code/artifact/82835c33-0407-4c4b-9a59-03a08f9ec121) | Persistent manager history, skill stats and ranks, the Versus tab |
| [Trade Calculator — PRD](spec-trade-calculator.md) *(repo only, Oct 21)* | Redraft trade calculator for 2–4 teams; values blend projections with real Sleeper trades. Not yet placed in the launch order |

## Launch order

1. **Now through the playoffs:** Duel Live on single games, plus highlights. Neither needs anyone to move their league.
2. **Before next draft season:** manager profiles, history import, Versus tab, player profiles v2.
3. **Next season:** Duel Week, live modes for season-long leagues, brackets.

## How these depend on each other

- Duel results feed manager profiles and skill ranks.
- Highlights appear on player profiles, team pages and the Watch tab.
- Player profile stats and Duel scoring share the same stats pipeline.

## Not yet in a PRD

- Live modes for season-long leagues (in-game swaps inside a regular league).
- The weekly points system that only goes up, separate from skill rank.
- Product name: staying FieldScout for now. Other names were brainstormed but nothing is decided.

## Files in this repo

The Claude Docs links above are the editable originals. Repo copies live next to the other specs in `docs/specs/`:

- `spec-next-phase-index.md` (this file)
- `spec-duel.md`
- `spec-highlights-watch.md`
- `spec-player-profiles.md`
- `spec-manager-profiles-versus.md`
- `spec-trade-calculator.md`
- `prompt-next-phase-architect-pass.md` — the Claude Code prompt for building from these

Overlaps with older specs: `spec-highlights-watch.md` supersedes the embedded-video phases of `spec-youtube-highlights.md`, and `spec-duel.md` overlaps the live-scoring parts of `spec-leagues-live-mode.md`.
