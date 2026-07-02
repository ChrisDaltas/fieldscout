# Spec: Ask AI

## Phase
Phase 9 — AI Features

## Overview

Ask AI is a general-purpose fantasy football research assistant. Users ask any natural language question about lineup decisions — start/sit, waiver wire, trade evaluation, bye week management, FAAB — and the AI returns factor-by-factor analysis with confidence scores. It shows its work and never forces a single answer.

---

## Core Philosophy

- The AI is a **research assistant**, not an oracle
- Every recommendation is backed by short, plain-English factor statements
- When it's a close call, it says so explicitly ("52% / 48% — this is a coin flip, go with your gut")
- When data clearly favors one option, it says that too

---

## User Inputs

- Free-text question in natural language
- Players to evaluate (extracted from question, or manually added via player search)
- Scoring system (Standard / PPR / Half-PPR / custom)
- League format (optional: redraft, keeper, dynasty)
- Roster context (optional free-text: "I have no other RBs")

---

## Data Sources (assembled per player before Claude API call)

1. Recent performance — last 4 weeks from `player_stats`
2. Injury status — current week from Sleeper API
3. Defensive matchup grade — opponent's stats vs. position from nflverse
4. Vegas implied totals — from The Odds API (`https://the-odds-api.com`, free tier)
5. Expert consensus — pulled at query time via Claude's web search (FantasyPros, Rotowire, ESPN, The Ringer, Rotoworld)
6. Season-long value — ADP trend from FantasyPros

---

## AI Output Structure

The Claude API returns structured JSON rendered into cards:

```json
{
  "player": "Justin Jefferson",
  "position": "WR",
  "team": "MIN",
  "factors": [
    { "label": "Matchup", "value": "B+", "note": "Chicago allows 28.4 PPR pts/game to WRs" },
    { "label": "Injury", "value": "Full practice", "note": "No injury designation" },
    { "label": "Vegas", "value": "Favorable", "note": "Vikings implied 27.5 pts, 260 passing yards" },
    { "label": "Recent form", "value": "Strong", "note": "24, 31, 18, 27 PPR pts last 4 weeks" },
    { "label": "Expert consensus", "value": "WR8", "note": "FantasyPros WR8, Rotowire must-start" }
  ],
  "summary": "Jefferson is in a great spot — favorable matchup, healthy, high-scoring game projected.",
  "short_term_value": "high",
  "long_term_value": "elite"
}
```

---

## Question Type Detection

The prompt instructs Claude to classify the question first, then adapt output:
- **Start/sit** — rank players, output floor vs. ceiling options
- **Waiver wire** — add FAAB % recommendation and rest-of-season value
- **Trade evaluation** — compare both sides of the trade
- **Streaming** — emphasize single-week matchup and Vegas data
- **Bye week** — emphasize depth and handcuff value

---

## Claude API Prompt Template

```
You are a fantasy football research assistant for FieldScout. Present the best available data — not a single answer, but the factors the user needs to decide for themselves.

The user's question: {user_question}
Scoring system: {scoring_system}
League format: {league_format}
Additional context: {roster_context}

Player data:
{player_data_packet}

Using this data and expert sources (FantasyPros, Rotowire, ESPN Fantasy, The Ringer, Rotoworld):
1. Write 3–5 factor statements per player: matchup, injury, Vegas, recent form, expert consensus
2. Write one summary sentence per player
3. Identify the highest-floor and highest-ceiling option with a confidence score (0–100)
4. If it's a close call (within 10 points), say so and tell the user to trust their gut
5. Adapt output for question type (waiver = FAAB %, trade = both sides compared)

Return valid JSON matching the schema in spec-ask-ai.md.
```

---

## Gating

- Pro only — gate behind `is_pro` check on the server route before calling Claude API
- Free users see the interface with an upgrade prompt on submit

---

## API Keys Needed

- `ANTHROPIC_API_KEY` — Claude API
- `THE_ODDS_API_KEY` — Vegas lines (free tier at https://the-odds-api.com)

---

## UI Components

- `src/app/(app)/ask/page.tsx`
- `src/components/ask/ask-input.tsx`
- `src/components/ask/scoring-selector.tsx`
- `src/components/ask/player-eval-card.tsx`
- `src/components/ask/confidence-meter.tsx`
- `src/components/ask/options-summary.tsx`
- `app/api/ask/route.ts`
