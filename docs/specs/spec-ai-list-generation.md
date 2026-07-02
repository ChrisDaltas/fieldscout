# Spec: AI List Generation

## Phase
Phase 1 — MVP

## Overview

Users can generate a ranked player list using AI by selecting a position, scoring format, a ranking bias or expert personality, and a player count. The AI returns an ordered list with a short rationale for each player's placement. The generated list can be saved as a new list or used to seed their Big Board.

---

## Core Philosophy

- AI list generation is a **starting point**, not a final answer
- Every player placement includes a one-line reason so users understand the logic
- Users can edit, reorder, and modify the generated list immediately after it's created
- The feature lowers the barrier to entry for users who don't know where to start

---

## User Inputs

| Input | Options |
|-------|---------|
| Position | QB, RB, WR, TE, FLEX, K, DEF, Overall |
| Scoring format | Standard, PPR, Half-PPR |
| Ranking style | See options below |
| Player count | 5 / 10 / 15 / 25 / 50 (picker) |

### Ranking Style Options

**AI Persona Styles** (emulates the persona's tendencies — see spec-ai-expert-personas.md for the roster and parody-naming convention):
- Consensus (default) — blended expert consensus, no strong bias
- Bathew Merry (AI) — positive, narrative-driven, upside-focused
- ZJ Jachariason (AI) — analytics-first, late-round QB, regression-aware
- Kina Mimes (AI) — film + scheme fit, skeptical of empty production
- Yield Fates (AI) — tier-based, big WR top tier, fluid at the top

Persona options inject the persona's `style_profile`, its live `persona_context` (current sourced stances and recent movements), and the latest `persona_source_rankings` where available into the `{style_description}` slot of the prompt template below. The context layer is kept fresh by the daily ingestion job — see [spec-ai-content-engine.md](spec-ai-content-engine.md).

**Analytical Biases** (data-driven filters):
- Age & Prime — favor players aged 24–28, discount players 30+
- Last Season Fantasy Points — rank strictly by prior season total output
- Strength of Schedule — favor players with the easiest remaining schedule
- Target Share / Air Yards — favor WRs and TEs with high target volume
- Breakout Upside — favor younger players with ascending usage trends

---

## AI Output Structure

The Claude API returns an ordered array of players with rationale:

```json
{
  "position": "WR",
  "scoring": "PPR",
  "style": "Target Share / Air Yards",
  "player_count": 10,
  "players": [
    {
      "rank": 1,
      "player_id": "uuid",
      "player_name": "Ja'Marr Chase",
      "team": "CIN",
      "rationale": "Led all WRs in target share last season at 32%. Elite route runner in a pass-heavy offense."
    },
    {
      "rank": 2,
      "player_id": "uuid",
      "player_name": "Justin Jefferson",
      "team": "MIN",
      "rationale": "Consistent 25%+ target share over three seasons. Top air yards per game in the league."
    }
    // ... remaining players
  ],
  "style_note": "This list prioritizes target volume and air yards over touchdowns or rushing versatility."
}
```

---

## Claude API Prompt Template

```
You are a fantasy football ranking assistant for FieldScout. Generate a ranked list of the top {player_count} {position} players for {scoring} scoring.

Ranking style: {style}
{style_description}

Here is the current player data for all active {position} players:
{player_data_packet}

Instructions:
1. Return exactly {player_count} players, ranked 1 through {player_count}
2. For each player, write one concise sentence (max 20 words) explaining their placement
3. Stay true to the ranking style — the rationale should reflect that bias clearly
4. Do not include injured players on IR
5. Return valid JSON matching the schema in spec-ai-list-generation.md

At the end of the list, include a one-sentence "style_note" explaining what this ranking style prioritized.
```

---

## Player Data Packet

Before calling the Claude API, assemble per-player data from the FieldScout DB:
- Full name, team, position, age
- Prior season fantasy points (standard, PPR, half-PPR)
- Prior season target share (WR/TE), carry share (RB), snap % (all)
- Current season injury status (from Sleeper API)
- Strength of schedule rating for remaining games
- ADP (from Sleeper API)

---

## UI Flow

1. User clicks "Generate with AI" button (on My Lists page or Big Board)
2. A modal opens with the input form (position, scoring, style, count)
3. User clicks "Generate" — loading state while Claude API is called (~3–5 seconds)
4. Results appear in the modal as a ranked list preview with rationale visible on hover/tap
5. Two actions at the bottom: "Save as New List" or "Close"
6. Saved list opens immediately in the list editor for further customization

---

## Gating

- AI List Generation is a **Pro-only feature**
- Free users see the "Generate with AI" button but get an upgrade prompt on click
- Gate behind `is_pro` check on the server route before calling Claude API

---

## Additional Requirements for Phase 1

This feature requires the following to be in place:
- NFL player data pipeline (Phase 0) — player stats and injury data must be available
- Anthropic API key: `ANTHROPIC_API_KEY` added to `.env.local`
- Player data endpoint that can return filtered, structured data for a given position

---

## UI Components

- `src/components/lists/generate-ai-modal.tsx` — input form + results preview
- `src/components/lists/ai-player-row.tsx` — player row with rationale
- `src/components/lists/generate-ai-button.tsx` — trigger button (with Pro gate)
- `app/api/lists/generate/route.ts` — assembles data packet, calls Claude API, returns structured JSON

---

## API Keys Needed

- `ANTHROPIC_API_KEY` — Claude API calls
