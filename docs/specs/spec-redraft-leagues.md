# PRD / Spec: Redraft Leagues + Custom Draft Engine

**Feature:** Real, playable weekly redraft fantasy football leagues with a fully configurable draft room and an all-powerful, fully-audited commissioner.
**Version:** 1.6 (Draft)
**Author:** Chris Daltas
**Date:** June 24, 2026
**Status:** Draft — ready for Claude Code build planning
**Codename:** Hadouken · **Product:** FieldScout (fieldscout.gg)

> This document is written to be handed directly to Claude Code. It follows the conventions in the repo root `CLAUDE.md`, `docs/02-TECHNICAL-ARCHITECTURE.md`, `docs/03-DATA-MODEL.md`, and `docs/06-DESIGN-SYSTEM.md`. SQL, RLS, file paths, and naming match the existing codebase. Where it extends existing tables (`leagues`, `teams`, `team_lineups`, `league_chat`, `scoring_systems`), it says so explicitly and ships a migration.

---

## 1. TL;DR

Today FieldScout treats a "league" as a *simulation* of a user's real home league (see `docs/01-PRD.md` §F9 and `docs/specs/spec-leagues-live-mode.md`). This feature turns FieldScout into a place where friends actually **play**: create a league, invite 8–20 friends, run a real **snake or auction draft** inside a live draft room, then compete head-to-head each week with live scoring, waivers/FAAB, and trades.

It pulls the "Real Fantasy Platform" idea (`docs/01-PRD.md` → V3 Future) forward as a major epic and supersedes the lightweight Phase 8 leagues model.

**Two things make it different from ESPN / Yahoo / Sleeper:**

1. **A draft room a commissioner can fully control** — snake *or* auction, configurable pick/nomination/bid timers, draft & nomination order, **pause/resume, granular undo, and drag-a-player-to-another-team** to fix anything that breaks mid-draft (disconnects, bad picks, app glitches).
2. **A commissioner who can change anything, anytime — with a receipt.** Every override (including *changing the outcome of a head-to-head matchup* when someone starts an ineligible player) is allowed, but every action writes an **immutable, league-visible audit entry** with actor, reason, and before/after state. This directly attacks the one thing every incumbent does badly: transparency of commissioner power.

---

## 2. Background & Strategic Rationale

### 2.1 Why now / why this matters
FieldScout already has the primitives this feature needs: `profiles`, `players`, `player_stats`, `nfl_games`, `scoring_systems`, `lists`, `teams`, `team_lineups`, and a real-time/cron stats pipeline. The missing layer is **competition with other people inside a hosted league** — the highest-retention surface in all of fantasy. Owning the league means owning the weekly habit, the group chat, and the reason friends invite friends.

### 2.2 What we learned from the incumbents (research summary)
Research covered ESPN, Yahoo, Sleeper, Flock Fantasy, and Footballguys; cross-checked against NFL.com, MyFantasyLeague (MFL), and Fleaflicker. Full tables in **Appendix A**. Headlines that shaped this spec:

- **Two of the named platforms are not league hosts.** **Flock Fantasy** is an analytics/rankings/content companion that *syncs to other platforms' leagues*; it has no draft engine or league/scoring/commissioner settings to mirror. **Footballguys** is a research/projections/draft-*assistant* business (Draft Dominator runs *alongside* a draft hosted elsewhere). Useful as feature/UX inspiration, but neither defines "how a host should work." **The benchmarks to beat are Sleeper (best draft + best commish transparency), with ESPN/Yahoo as the mass-market baseline.**
- **Sleeper is the gold standard for the draft engine**: snake / linear / 3rd-round-reversal / auction / best-ball, pick timers from **10 seconds to 24 hours**, unlimited pause and pick-undo, force-CPU-pick for disconnected drafters, and — critically — **commissioner override actions auto-post to league chat and cannot be silenced**.
- **The universal weakness is commissioner transparency.** Every platform lets a commissioner silently edit rosters and effectively rewrite scores. **None offers a real, tamper-evident, member-visible audit log of commissioner actions.** Yahoo is the murkiest on manual score edits; MFL even lets a commissioner *delete* transaction records. This is FieldScout's clearest wedge and aligns exactly with the product goal: *let the commissioner do anything, but make it visible.*
- **No platform has a native "illegal-lineup penalty" engine.** Starting a bye/OUT/ineligible player simply scores 0; any further consequence is a house rule the commissioner enforces by hand. FieldScout's commissioner tools make that workflow first-class (flag → override result → logged with reason).
- **Defaults worth copying:** 4–20 teams, half-PPR is the modern default, decimal scoring on, individual-game lineup lock by default, auction budget **$200**, FAAB budget **$100**, FAAB and auction budgets are **separate pools**.

### 2.3 Positioning vs. existing FieldScout features
| Existing | Relationship to this feature |
|---|---|
| `docs/01-PRD.md` §F8 **Teams** | A league roster *is a* team. We reuse `teams` (and its `league_id`) as the per-manager entity inside a league. |
| `docs/01-PRD.md` §F8A **Live Mode** | Live scoring for a league lineup reuses the Live Mode pipeline (`sync-live-stats`, `player_stats`, `nfl_games`). |
| `docs/01-PRD.md` §F9 **Leagues (simulation)** & `spec-leagues-live-mode.md` | **Superseded/expanded.** The simulation concept (placeholder teams, AI recs, History Mode) becomes one mode of a real, playable league. This spec replaces the thin `leagues` schema with a complete one (migration provided). |
| `scoring_systems` | Reused directly for league scoring; we extend the `rules` JSONB catalog (Appendix B). |

---

## 3. Goals & Non-Goals

### 3.1 Goals
1. A commissioner can create a redraft league for **4–20** managers (even counts) and configure **every** league, roster, and scoring setting (Appendix B), with sensible defaults so a league can be created in under 2 minutes.
2. A league can run a **real-time snake or auction draft** with configurable order, timers, autopick, queueing, and chat — playable on desktop and mobile.
3. The commissioner has **complete live draft control**: pause/resume, undo (single or cascade), edit/reassign any pick, move a drafted player to another team, force a pick for a manager, and recover gracefully from disconnects.
4. The league plays a full season: weekly H2H matchups, live scoring against the league scoring system, standings/tiebreakers, **waivers + FAAB**, **trades**, free agency, and playoffs.
5. The commissioner can **override anything at any time** — scores, results, rosters, transactions, budgets, schedule — and **every override is captured in an immutable, league-visible audit log** with a required reason and before/after diff.
6. Ship behind the existing **Pro** gate for league creation (joining is free), consistent with current business rules.

### 3.2 Non-Goals (v1)
- **Real money / entry fees / payouts.** No wallet, no LeagueSafe-style escrow. (Revisit post-v1; see Open Questions.)
- **Keeper / dynasty / best-ball formats.** Redraft only in v1. Schema leaves room (`league.format` enum) but logic is out of scope.
- **Daily fantasy (DFS), salary-cap weekly contests.** Out of scope.
- **Offline/email/"slow" multi-day drafts as the default.** Architecture supports long pick timers (up to 24h) so slow drafts are *possible*, but the v1 product target is a live, same-session draft. Full offline draft-result import is out of scope.
- **IDP as a default.** IDP slots/scoring are supported in the schema and settings (so power users can enable them) but are off by default and not the v1 QA focus.
- **Native mobile apps.** Responsive web only (matches current stack).
- **Cross-platform league import** (pulling a league from ESPN/Sleeper). Out of scope.

---

## 4. Target Users & Personas

- **The Commissioner (primary).** Usually the friend who "runs the league." Wants total control, fast setup, and tools to fix problems live without derailing draft night or starting an argument. Pain today: incumbents hide or limit their powers, and any manual fix looks shady to the league. Our promise: *do whatever you need — it's logged and fair.*
- **The Manager (primary).** Plays in the league. Wants a smooth draft, a clear weekly matchup, easy waivers/trades, and confidence the commissioner isn't cheating. Our promise: *full visibility into every commissioner action.*
- **The Co-Commissioner (secondary).** A manager the commissioner deputizes for shared admin. Same powers, same audit trail.
- **The FieldScout power user (secondary).** Already builds Big Boards and custom scoring; now drafts a real team using those rankings (draft board can surface their FieldScout Big Board / queue).

---

## 5. Dependencies & Roadmap Placement

This is a large epic that depends on foundations from earlier phases. It should not be built before them.

**Hard dependencies (must exist first):**
- Phase 0 Foundation: `profiles`, `players`, `player_stats`, `nfl_games`, `scoring_systems`, auth, app shell.
- Phase 2 Teams: `teams`, `team_lineups`, fantasy-points utility (`src/utils/calculate-fantasy-points.ts`).
- Phase 3 Scoring Systems: custom scoring create/apply.
- Phase 4 Pro Subscription: `is_pro` gating.
- Phase 8 Live Mode pipeline: `sync-live-stats`, real-time `player_stats`/`nfl_games`.

**Roadmap recommendation:** treat this as the headline of **Phase 8 (Leagues + Live Mode)**, expanded into its own multi-part epic, or as the "V3 Real Fantasy Platform" milestone pulled forward. It replaces `spec-leagues-live-mode.md`'s thin `leagues` schema. See §18 for the internal phasing (A–F) of just this feature. **Decision for Chris:** confirm whether this lands as expanded-Phase-8 or a dedicated track (Open Questions §21).

---

## 6. Glossary

| Term | Meaning |
|---|---|
| **League** | A hosted, playable competition of 8–20 managers (even counts) for one NFL season. Has one commissioner, settings, a draft, matchups, standings. |
| **Commissioner** | The league's admin/owner. Has unrestricted override powers (all logged). Can appoint co-commissioners. |
| **Manager** | A league member who owns one team. |
| **Team (league roster)** | A manager's roster within a league. Reuses the `teams` table (`teams.league_id`). Distinct from a FieldScout "list." |
| **Draft Room** | The real-time interface where the league drafts players. |
| **Snake draft** | Serpentine order: 1→N then N→1 each round. Optional 3rd-round reversal. |
| **Auction draft** | Managers nominate players and bid against a per-team budget; high bid wins. |
| **Pick clock** | Per-pick countdown in a snake/linear draft. |
| **Nomination clock / Bid clock** | Auction timers: time to nominate, and time for bidding (with anti-snipe reset). |
| **Autopick / Autodraft** | System picks for a manager (on timeout or if set to auto), using their queue then Big Board then ADP. |
| **Queue** | A manager's personal ordered list of players they want next; feeds autopick. |
| **Roster slot** | A starting position or a reserve (BN/IR). Each slot is an *eligible-position set* + a count, fully set by the commissioner. A **flex** is any slot accepting 2+ positions (e.g., WR/TE, WR/RB, WR/RB/TE, superflex) — the commissioner chooses the combination. |
| **Player exclusivity** | Within one league, an NFL player can be rostered by at most one team (enforced in DB). |
| **FAAB** | Free Agent Acquisition Budget — the season-long *blind-bid* budget for in-season waiver claims. Separate pool from the auction budget. |
| **Auction budget** | The one-time budget used to buy players *during* an auction draft. |
| **Waivers** | The process governing how dropped/unowned players are claimed (rolling priority, reverse-standings, or FAAB). |
| **Matchup** | A weekly head-to-head pairing between two teams. |
| **Override** | Any commissioner action that changes state outside the normal rules (edit score, set result, move player, reverse trade, etc.). Always logged. |
| **Commissioner Action Log (audit log)** | Immutable, append-only, league-visible record of every override. The differentiator. |
| **Lineup lock** | The moment a starting slot can no longer be edited (default: each player's individual kickoff). |
| **League-tagged list** | One of a user's ranking lists *attached to a league* (§7.4) so it's one tap away in that league's Live Draft Tool — as a cheat sheet, a pool overlay, a queue source, or the team's primary draft board. Attachable to multiple leagues; optionally shared with the whole league. |
| **Restricted / Unrestricted IR** | A per-IR-spot rule set by the commissioner (§7.3.2). *Unrestricted*: the manager moves eligible players in/out freely before lock. *Restricted* (baseball-IL style): requires an eligible designation **and** a minimum stint (default 4 weeks) before the player can be removed. |
| **Swap spot** | An optional roster spot (§7.3.2). A team arms **one** bench player to auto-start in place of a chosen starter if that starter is ruled out pre-game or injured in-game. The swap player must be the **exact same position** as the protected starter (even if the starter is in a FLEX). Locks at first Sunday kickoff (or Thursday if a Thursday player is involved). |

---

## 7. Feature A — League Creation & Settings

### 7.1 League lifecycle (status machine)
A league moves through explicit states; many behaviors gate on `league.status`.

```
setup → scheduled → drafting → in_season → playoffs → complete
                         ↑__________ (commissioner can re-open / roll back)
```

| Status | Meaning | Key allowed actions |
|---|---|---|
| `setup` | Created, configuring settings, inviting managers | Edit all settings, invite/remove members, set draft |
| `scheduled` | Settings locked enough to schedule a draft; draft has a date/time | Final pre-draft tweaks, draft order, queues, mock |
| `drafting` | Draft room is live or paused | All draft controls (§8) |
| `in_season` | Draft complete; weekly play | Lineups, waivers, trades, scoring, overrides |
| `playoffs` | Bracket active | Same as in_season + bracket management |
| `complete` | Season ended | Read-only + History; commissioner can still override (logged) |

A commissioner may move the league backward (e.g., `drafting → setup` via "Reset Draft", or `in_season → drafting` to redo a botched draft) — each such transition is an audited override.

### 7.2 Membership, roles & invites
Roles live in a new `league_members` table (§12): `commissioner`, `co_commissioner`, `manager`.

**Requirements**
- **Create league** (Pro only — gate on `is_pro`): name, season, `team_count` ∈ {8, 10, 12, 14, 16, 18, 20}, and a settings wizard (7.3). Creator becomes `commissioner` and gets a team.
- **Invite** via shareable invite code/link (`leagues.invite_code`, already exists) and/or by FieldScout username. Optional email invite (uses existing notifications + email flow).
- **Join** with invite code (free; not Pro-gated — matches current rule "Free: can join unlimited leagues but cannot create"). On join, a `teams` row is created for the manager with `league_id` set.
- **Placeholder/managed teams.** Commissioner can create empty seats (a `teams` row owned by the commissioner, flagged `is_placeholder`) so the draft can run before everyone has joined; ownership can be reassigned to a real user later (audited).
- **Roles.** Commissioner can promote a manager to `co_commissioner` (full powers, audited) or demote. Exactly one `commissioner`; multiple `co_commissioner` allowed. The original creator can never be removed by a co-commissioner.
- **Kick/replace.** Commissioner can remove a manager (pre-draft) or reassign a team to a new manager (any time; audited). Removing mid-season is an override (roster handling defined in §11 / §13).
- **Capacity.** Cannot start a draft until the number of active teams equals `team_count` (commissioner may override to draft short — audited — with empty seats auto-set to autopick).

### 7.3 Settings catalog
All settings are editable in `setup`/`scheduled`. After the draft, structural settings (roster slots, team count, scoring categories) become **commissioner-override-only** (changing them mid-season is allowed but logged and warned). Store settings as typed columns where queried often, and in a `settings JSONB` blob on `leagues` for the long tail (see §12 schema). **Defaults below are the league-creation defaults.**

Legend: **D** = default · **R** = allowed range/options.

#### 7.3.1 Format & structure
| Setting | D | R / Options | Notes |
|---|---|---|---|
| `format` | `redraft` | redraft (only one enabled v1; keeper/dynasty/best_ball reserved) | Drives draft + offseason logic. |
| `team_count` | 12 | **8, 10, 12, 14, 16, 18, 20** | Even only in v1. Large (16–20) leagues: validate the draftable player pool (§7.3 validation). |
| `divisions` | 1 | 1–2 (v1) | If 2, must split evenly; used for standings & playoff seeding. |
| `regular_season_weeks` | 14 | 12–15 | Must leave room for playoffs within weeks 1–18. |
| `playoff_teams` | 6 | 0, 2, 4, 6, 8, 10, 12 (≤ team_count) | 0 = no playoffs (points-only champion). |
| `playoff_start_week` | 15 | 14–17 | Validated against `regular_season_weeks`. |
| `playoff_weeks_per_round` | 1 | 1–2 | 2 = two-week rounds. |
| `playoff_byes` | auto | derived from bracket size | Top seeds get byes when bracket > playoff_teams. |
| `playoff_reseed` | true | true/false | Reseed each round by seed. |
| `consolation_bracket` | false | true/false | "Toilet bowl" for non-playoff teams. |
| `third_place_game` | false | true/false | |

#### 7.3.2 Roster & lineup slots (fully commissioner-configurable)
The commissioner sets **every roster number**: how many starters at each position, how many **flex** slots and exactly which positions each flex accepts, how many **bench** spots, and how many **IR** spots. Total roster size is derived. There are **no hard-coded lineup templates** — a league's roster is a *list of slot definitions*, so any real-world configuration can be reproduced (a superset of ESPN/Yahoo/Sleeper).

**Core model — a slot = an eligible-position set + a count.** Single-position slots (QB, RB, WR, TE, K, D/ST, individual IDP) are simply slots whose eligible set has one position. **A flex is any slot whose eligible set has 2+ positions, and the commissioner picks the combination.** The builder ships common presets *and* an **"Add custom flex"** that opens a position multi-select — so WR/TE, WR/RB, RB/TE, WR/RB/TE, QB/WR/RB/TE (superflex), "any offensive player," an IDP flex, or **any other combination** are all first-class. A league may have **multiple, differently-defined flex slots at once** (e.g., 1× W/R/T + 1× W/T + 1× SUPERFLEX).

**Starter slot presets** (add any count, or build your own via custom flex):

| Preset key | Label | Eligible positions | Default count (12-team) |
|---|---|---|---|
| `qb` | QB | QB | 1 |
| `rb` | RB | RB | 2 |
| `wr` | WR | WR | 2 |
| `te` | TE | TE | 1 |
| `flex` | FLEX (W/R/T) | WR, RB, TE | 1 |
| `wr_rb` | W/R | WR, RB | 0 |
| `wr_te` | W/T | WR, TE | 0 |
| `rb_te` | R/T | RB, TE | 0 |
| `superflex` | SUPERFLEX (OP) | QB, WR, RB, TE | 0 |
| `k` | K | K | 1 |
| `dst` | D/ST | DST | 1 |
| `dl` / `lb` / `db` / `idp_flex` | IDP slots | DL / LB / DB / any IDP | 0 (off by default) |
| *custom* | *commissioner-named* | *any chosen set of ≥ 2 positions* | — |

**Reserve slots:**

| Key | Label | Default | Range |
|---|---|---|---|
| `bench` | Bench (BN) | 6 | 0–20 |
| `ir_slots` | Injured Reserve (IR) | 1 unrestricted spot | 0–6 spots — each set Restricted/Unrestricted (see IR slot rules below) |
| `swap_spots` | Swap spot (auto-sub) | 0 (off) | 0 or 1 (on/off) — one swap per team (see Swap spot rules below) |

- **Per-position starter counts** are each configurable **0–10**.
- **Derived:** `roster_size = Σ(all starting slot counts) + bench + ir`. The wizard shows it live and validates `roster_size × team_count ≤ draftable player pool` (warns for large/IDP leagues).
- **Canonical `leagues.roster_settings` JSONB.** Each starting slot is an instance with a **unique `key`**, so two different flex slots are distinguishable in the lineup:
  ```json
  {
    "starting_slots": [
      { "key": "qb",        "label": "QB",        "eligible": ["QB"],                "count": 1 },
      { "key": "rb",        "label": "RB",        "eligible": ["RB"],                "count": 2 },
      { "key": "wr",        "label": "WR",        "eligible": ["WR"],                "count": 2 },
      { "key": "te",        "label": "TE",        "eligible": ["TE"],                "count": 1 },
      { "key": "flex1",     "label": "W/R/T",     "eligible": ["WR","RB","TE"],      "count": 1 },
      { "key": "flex2",     "label": "W/T",       "eligible": ["WR","TE"],           "count": 1 },
      { "key": "superflex", "label": "SUPERFLEX", "eligible": ["QB","WR","RB","TE"], "count": 0 },
      { "key": "k",         "label": "K",         "eligible": ["K"],                 "count": 1 },
      { "key": "dst",       "label": "D/ST",      "eligible": ["DST"],               "count": 1 }
    ],
    "bench": 6,
    "ir_slots": [
      { "key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT","IR"] }
    ],
    "swap_spots": 0
  }
  ```
- **Eligibility check:** a player fits a slot when `player.position ∈ slot.eligible` (multi-position eligibility — e.g., a player listed RB/WR — supported via a per-player eligibility array; see §11.1 and the legality helper). Each IR spot accepts only players holding one of that spot's **eligible designations** (see IR slot rules below); `bench` accepts anyone on the roster.

**IR slot rules (set per IR spot).** The commissioner adds 0–6 IR spots and configures **each one independently**:
- **Type — Unrestricted:** the manager may move eligible players in and out **as often as they like** (any time before that player's lineup locks), as long as the player holds an eligible designation.
- **Type — Restricted (baseball-IL style):** the player must hold an eligible designation **and remain in the spot for a minimum stint (`min_weeks`, default 4)** before the manager may remove them. Early removal is blocked (commissioner can override, §10).
- **Eligible designations (per spot):** which player statuses qualify — drawn from `players.status` / the injury feed (e.g., **OUT, IR, Doubtful, PUP, NFI, Suspended**). Default: **OUT, IR**. A player may be placed on a spot only while holding one of that spot's designations.
- **`min_weeks` (restricted only):** default **4**, range 1–17. Tenure is counted in NFL weeks: placed in week *W* → removable in week *W + min_weeks*.
- **Enforcement:** IR'd players never count toward the lineup and score nothing; if an IR'd player loses eligibility (returns to active) the roster is flagged illegal until they're moved off — but a Restricted player still cannot be removed before the stint completes (commissioner override available). All IR moves respect lineup-lock timing. Tenure is tracked on `league_rosters` (`ir_placed_week`, `ir_lock_until_week`, §12.7).

**Swap spot rules (optional; one armed auto-substitution).** A Swap spot lets a manager designate a **bench player to auto-start if a chosen starter is knocked out** — before the game or during it. It's a safety net, not a free roster slot.
- **One swap per team.** The Swap spot is an **on/off** league setting (`swap_spots` = 0 or 1). When on, each team gets **exactly one** swap per week: pick the **starter to protect** (the *out* player) and the **bench player** that replaces them (the *in* player). (Deliberately capped at one — multiple auto-subs make an opponent's lineup confusing to follow mid-week.)
- **Exact-position match (key rule).** The *in* player must play the **exact same `player.position`** as the *out* player — RB↔RB, WR↔WR, etc. — **even if the out player occupies a FLEX or SUPERFLEX slot.** (You protect an RB-in-FLEX with an RB, not a WR.) The position is fixed by the starter you choose at assignment time. Because positions match, the *in* player is automatically legal for the *out* player's exact slot.
- **Lock / arm time.** The swap is editable until the team's weekly lock, then **armed**: lock is the **first Sunday kickoff**, or the **Thursday kickoff** if either the *out* or *in* player is in a Thursday game (so a swap can't be set after seeing Thursday results).
- **Triggers (automatic once armed — no manager action needed):**
  - **Pre-game inactive** — the *out* player is ruled OUT/inactive at their kickoff → the *in* player takes the *out* player's exact starting slot for the week and scores normally.
  - **In-game injury** — the *out* player leaves and is ruled out during the game (per the live feed) → the swap fires; the team is credited the **greater of** the *out* player's accrued points or the *in* player's full points for that slot (default resolution; see Open Questions §21).
  - If neither trigger fires, the swap stays inactive and the original starter scores normally.
- **Mechanics.** A game-day worker (§14) watches `players.status` / `nfl_games` / the live feed, fires armed swaps, records them to `lineup_swaps` (§12.16), posts to the league activity feed, and reflects the change live in the matchup. Commissioner can override any swap outcome (logged, §10).
- **Stored** as `roster_settings.swap_spots` (0/1) in the §7.3.2 JSONB; per-week assignments in `lineup_swaps` (§12.16).
- **Display order:** render the Swap spot directly **below the Flex/superflex slots** and **above K, D/ST, and IR** in both the lineup view and the roster-builder.

#### 7.3.3 Scoring
- **Engine:** reuse `scoring_systems` (`rules JSONB`). The league references one `scoring_system_id`. Commissioner picks a **preset** or builds **custom**.
- **Presets shipped** (system defaults, `is_system_default = true`): `Standard (non-PPR)`, `Half-PPR`, `Full PPR`, plus platform-flavored `ESPN PPR`, `Yahoo Half-PPR`, `Sleeper Half-PPR`. Full point tables in **Appendix B**.
- **Custom catalog** (every category editable; decimals supported): passing (yds/TD/INT/2pt/300+ & 400+ bonuses), rushing (yds/TD/2pt/100+ & 200+ bonuses), receiving (rec [0/0.5/1/custom, **TE-premium** supported], yds/TD/2pt/100+ & 200+ bonuses), fumbles lost, misc TDs/return TDs, **kicking by distance** (0–39/40–49/50+/made PAT/missed FG/missed PAT), **D/ST** (sack/INT/FR/TD/safety/blocked kick/return TD + **points-allowed tiers** and optional **yards-allowed tiers**, supporting both ESPN's split model and Yahoo's single-tier model), and **IDP** (tackle solo/assist, sack, TFL, QB hit, INT, PD, FF, FR, def TD, safety). Full key list in Appendix B.
- **Decimal/fractional scoring:** on by default.
- **Half-point per-reception** and **TE premium** are first-class toggles in the editor.

#### 7.3.4 Waivers & free agency (in-season)
| Setting | D | R / Options | Notes |
|---|---|---|---|
| `waiver_type` | `faab` | `faab`, `rolling_priority`, `reverse_standings`, `none_fcfs` | |
| `faab_budget` | **100** | 0–1000 | Season-long blind-bid budget. Separate pool from auction. |
| `faab_min_bid` | 0 | 0–10 | |
| `faab_tiebreaker` | `reverse_standings` | `reverse_standings`, `rolling_priority` | Deterministic; resolves equal bids. |
| `waiver_process_day` | `wed` | tue/wed/thu + time | Cron-driven (§14). |
| `waiver_period_hours` | 48 | 0–168 | How long a dropped player sits on waivers. |
| `free_agency` | `immediate_after_waivers` | immediate / continuous | Unclaimed players become FCFS. |
| `acquisitions_per_week` | unlimited | unlimited or 0–50 | Per-team weekly add cap. |
| `acquisitions_per_season` | unlimited | unlimited or 0–500 | |

#### 7.3.5 Trades
| Setting | D | R / Options |
|---|---|---|
| `trade_review` | `commissioner` | `none` (instant), `commissioner`, `league_vote` |
| `trade_veto_votes` | ⌈team_count/2⌉ | 1–team_count (when `league_vote`) |
| `trade_review_period_hours` | 24 | 0–96 |
| `trade_deadline_week` | 11 | none or 1–regular_season_weeks |
| `allow_faab_in_trades` | false | true/false |
| `allow_future_considerations` | false | true/false (notes-only "gentleman's" trades; no draft picks in redraft) |

#### 7.3.6 Lineups & lock
| Setting | D | R / Options | Notes |
|---|---|---|---|
| `lineup_lock` | `per_player_kickoff` | `per_player_kickoff`, `first_game_of_week` | Default matches incumbents. |
| `allow_illegal_lineups` | true | true/false | If true, byes/OUT score 0 (incumbent behavior). If false, the slot is blocked at submit. Either way, commissioner can flag & override (the differentiator, §10). |
| `auto_sub_inactives` | false | true/false | Optional Sleeper-style auto-sub of inactive starters from bench (§11.3). |

#### 7.3.7 Tiebreakers (standings)
Ordered, reorderable list. Default order: **(1) Win %, (2) Head-to-head, (3) Points For, (4) Division record (if divisions), (5) Points Against, (6) Coin flip (deterministic seeded).** Stored as an ordered array in `settings`.

#### 7.3.8 Draft configuration
Lives on the league `settings` and is hydrated into a `drafts` row when scheduled (§8/§12).

| Setting | D | R / Options | Notes |
|---|---|---|---|
| `draft_type` | `snake` | **`snake`**, **`auction`**, `linear` | Linear is a cheap variant of snake; v1 QA focuses on snake + auction. |
| `snake_reversal` | false | true/false | 3rd-round reversal (Sleeper-style) when snake. |
| `draft_order_mode` | `random` | `random`, `manual`, `custom` | Manual = commissioner drag; custom = saved order. |
| `draft_order` | — | array of team_ids | Set/locked before start; commissioner editable. |
| `pick_timer_seconds` | 90 | **0 (untimed), 30, 45, 60, 90, 120, 180, 300, 600, 3600, 14400, 28800, 86400** | 0 = no clock; large values enable slow drafts (up to 24h). |
| `auction_budget` | **200** | 50–1000 | One-time draft budget. Separate from FAAB. |
| `auction_min_bid` | 1 | 0–5 | |
| `auction_nomination_seconds` | 30 | 10–120 | Time to nominate. |
| `auction_bid_seconds` | 20 | 10–60 | Bid clock; **anti-snipe**: a bid with < `anti_snipe_threshold` left resets clock to it. |
| `auction_anti_snipe_seconds` | 10 | 0–15 | 0 disables anti-snipe. |
| `nomination_order_mode` | `same_as_draft_order` | `same_as_draft_order`, `random`, `manual` | Circular. |
| `autopick_default` | `queue_then_board_then_adp` | (fixed strategy) | Queue → primary league-tagged board → season Big Board → ADP. See §8.4. |
| `disconnect_grace_seconds` | 30 | 0–120 | Disconnected manager isn't auto-picked until grace elapses (ESPN-style). |
| `draft_scheduled_at` | — | timestamptz | When the room opens. |

**Validation rules (enforced in API + DB constraints):**
- `team_count ∈ {8,10,12,14,16,18,20}`.
- `playoff_start_week + (playoff_rounds × playoff_weeks_per_round) − 1 ≤ 18`.
- Sum of starting slots ≥ 1 and ≤ 20; `roster_size` large enough that `roster_size × team_count` ≤ draftable player pool.
- Every starting slot has a unique `key` and a non-empty `eligible` set; **flex slots list ≥ 2 eligible positions**, single-position slots exactly 1; `bench` 0–20 and 0–6 IR spots.
- Each IR spot has a `type` (`unrestricted` | `restricted`) and ≥ 1 eligible designation; **restricted** spots set `min_weeks` ≥ 1 (default 4).
- A Swap assignment (when `swap_spots = 1`): the *out* player is a current starter, the *in* player is on the bench with the **same `player.position`**; **at most one swap per team per week**; editable only before the swap's lock.
- Auction: `auction_budget ≥ roster_size × auction_min_bid` (every team can fill a legal roster).
- Exactly one scoring system referenced and readable by the league.

### 7.4 Attaching ranking lists to a league (list ↔ league tie-in)
FieldScout's atomic unit is the ranking list (`docs/01-PRD.md` §F2). This ties a user's lists to the leagues they play in, so the rankings they built for *this* league are one tap away in the Live Draft Tool and all season.

- **Attach.** From any list (list detail, list card, or Big Board): **"Attach to league"** → pick from leagues the user belongs to. Reverse entry point from the league: **"Add a draft list."**
- **Many-to-many.** A list can be attached to multiple leagues; a league shows each member their own attached lists.
- **Primary draft board.** A member can mark one attached list as their **primary board** for the league — it feeds the draft queue and autopick (§8.4, §8.9).
- **Share (optional).** A member can mark an attachment **shared with the league** (e.g., the commissioner posts agreed keeper values); shared lists appear to all members, private ones stay visible only to their owner (RLS §12.15).
- **Non-destructive.** The list stays an independent object; detaching only removes the association — it never edits or deletes the list.
- **Smart suggestions.** When a list's scoring/format matches the league (e.g., a Superflex-PPR list ↔ a Superflex-PPR league), surface a one-tap "Attach to {league}." The league-create wizard also offers to attach existing lists.
- Framed in the UI with the familiar **tag** language, but stored as a first-class association (§12.15) — not a free-text tag — so the draft room, queue, and autopick can use it.

---

## 8. Feature B — Custom Draft Engine (the core)

The draft room is the highest-stakes, most concurrency-sensitive surface in the app. It must feel instant, never double-assign a player, never let a manager overspend, and let the commissioner fix anything live. The engine is **server-authoritative**: clients never decide who is on the clock, what time is left, or whether a pick is legal — the server does, and broadcasts truth.

### 8.1 Authoritative engine model
- **Single source of truth** is the `drafts` row (state, current pick index, deadline) plus the append-only `draft_picks` table. See §12.
- **Every state-changing action** (make pick, place bid, nominate, pause, undo, reassign, force pick) is performed by a **Postgres RPC function (`SECURITY DEFINER`)** called from a Route Handler, or by the Route Handler in a single transaction. The function:
  1. Locks the draft row (`SELECT ... FOR UPDATE`) to serialize concurrent actions.
  2. Validates legality (turn, budget, exclusivity, slot availability, draft status).
  3. Writes the pick/bid/event.
  4. Advances state (next picker / next nomination) and sets the new server-side `current_deadline`.
  5. Returns the new authoritative state.
- **Clients subscribe** via Supabase Realtime (§9) to `drafts` (UPDATE) and `draft_picks` (INSERT/UPDATE) and re-render from the broadcast. The countdown is rendered locally from `current_deadline` (a server timestamp) — clients never own the clock.
- **Concurrency:** the row lock + a `UNIQUE` partial index guaranteeing a player can be picked once per draft (`UNIQUE(draft_id, player_id) WHERE NOT is_undone`) make double-picks impossible even under race conditions. The loser of a race gets a friendly "Player just went off the board" error.
- **Idempotency:** actions carry a client-generated `action_id`; replays (double-tap, reconnect retry) are no-ops.

### 8.2 Timer enforcement & autopick worker
- The pick/nomination/bid deadline is stored on `drafts.current_deadline`.
- A lightweight **`draft-tick` worker** (Supabase Edge Function invoked by pg_cron every ~5s while any `drafts.status = 'live'`, plus an immediate self-schedule on each action) checks for expired deadlines and performs the timeout action atomically (autopick, or in auction: assign to current high bid / advance nomination). This mirrors the existing two-speed cron pattern in `docs/02-TECHNICAL-ARCHITECTURE.md`.
- Because enforcement is server-side, the draft is correct even if every client disconnects.
- **Soft timer option:** if `pick_timer_seconds = 0`, no auto-action; the clock is informational only (the commissioner advances things). Useful for casual/slow drafts.

### 8.3 Draft order
- **Snake/linear:** `draft_order` is an array of `team_id`s, set by `draft_order_mode` (random/manual/custom). Snake reverses each round; `snake_reversal` flips round 3. Linear repeats the same order every round.
- **Auction:** `nomination_order` is circular; `nomination_order_mode` controls it.
- Commissioner can edit order until the first pick (and after, as an override).
- A "Randomize Order" action with a visible animation (and an optional reveal screen) is supported; the result is written before the draft starts.

### 8.4 Queue & autopick
- Each manager has a personal **queue** (`draft_queues`): an ordered list of `player_id`s. Drag to reorder; players already drafted are auto-removed/skedaddled.
- **Autopick strategy** (`queue_then_board_then_adp`): on timeout or when a manager is in auto mode, pick the highest available from (1) their queue, else (2) their **primary league-tagged draft board** if they set one (§7.4), else (3) their FieldScout season-long Big Board order, else (4) lowest `players.adp`. The pick must fit an open slot (respect roster needs: don't autopick a 3rd QB into a 1-QB league if other needs are open — "best available that fills a need").
- Managers can toggle **"Auto-draft me"** (e.g., if they have to leave). Commissioner can toggle it for any team.

### 8.5 Snake draft flow
1. Room opens at `draft_scheduled_at` (or commissioner clicks **Start Draft**). Status → `drafting`.
2. Board shows: full pick grid (rounds × teams), available players (searchable/filterable, with FieldScout Big Board / tiers / ADP overlays), the on-the-clock team, the pick clock, my queue, my roster (slots filling up), and draft chat.
3. On the clock: the active manager selects a player → RPC validates (their turn, player available, fits roster) → writes `draft_picks` row → advances to next picker, resets clock → Realtime broadcast updates everyone.
4. Timeout → autopick (§8.4).
5. Disconnect → after `disconnect_grace_seconds`, that team flips to autopick for the current pick; reconnect restores manual control. Presence (§9) shows who's online.
6. Repeat until every roster is full. Status → `in_season`; initial `league_rosters` are populated from `draft_picks`.

### 8.6 Auction draft flow
1. Room opens; each team shows remaining **budget** and **max bid** (`budget − (open_slots − 1) × min_bid`).
2. The nominating manager (per `nomination_order`) nominates a player at an opening bid (≥ `auction_min_bid`); nomination clock enforces it (timeout → system nominates highest available or skips per setting).
3. Open bidding: any manager with sufficient max bid raises. Each bid resets the bid clock per **anti-snipe** (`auction_anti_snipe_seconds`). Bids are validated against live remaining budget and required roster slots.
4. Bid clock hits 0 → highest bidder wins; `draft_picks` row written with `price`; budgets recomputed; nomination advances.
5. Inactive/disconnected managers do not auto-bid by default (configurable later); they can still be nominated for and simply don't participate.
6. Repeat until all rosters legal/full or budgets exhausted (engine guarantees every team can always complete a legal roster via the max-bid formula).

### 8.7 Commissioner live draft controls (explicitly required)
All available from a **Draft Commissioner Panel** overlay in the room; **every one writes a `commissioner_actions` audit entry** (§10) and broadcasts.

| Control | Behavior |
|---|---|
| **Pause / Resume** | Freezes/refreezes all clocks. Unlimited. Banner shows "Draft paused by {commish}". |
| **Edit pick clock** | Change `pick_timer_seconds` live (applies to subsequent picks); may extend the current deadline. |
| **Undo last pick** | Reverts the most recent pick (player returns to pool, clock rewinds to that team). |
| **Undo to a point (cascade)** | Undo back to pick #N (everything after is reverted). Clear confirm dialog showing what will be undone. |
| **Edit / reassign a pick** | Change which player a given pick selected, or **move a drafted player to a different team** (drag a player from Team A's roster to Team B in the panel). Validates exclusivity & slots; writes before/after to the log. *(This is the "move players between teams easily if something breaks" requirement.)* |
| **Pick for a manager** | Make the current pick on behalf of the team on the clock (disconnect/AFK). |
| **Toggle autopick for any team** | Force a team to/from auto mode. |
| **Adjust auction budget / undo a won bid** | Correct a mis-click: reverse a winning bid (player back to pool, budget restored) or adjust a team's remaining budget. |
| **Reassign a draft seat** | Swap which user controls a team (e.g., a friend takes over for a no-show). |
| **Reset draft** | Wipe all picks back to pre-draft (status → `scheduled`). Hard confirm; fully audited; cannot be silent. |

**Disconnect/robustness requirements**
- Reconnect must restore the full room state in < 2s from the authoritative `drafts` + `draft_picks` snapshot (no reliance on missed broadcasts; client refetches state on reconnect, then resubscribes).
- If the commissioner disconnects, co-commissioners retain controls; if none, the draft auto-pauses after grace (configurable) so nothing runs unsupervised during an outage.
- All ephemeral UI (who's typing, hover) uses Broadcast/Presence and is non-authoritative.

### 8.8 Draft chat & mock drafts
- **Draft chat:** real-time chat scoped to the draft (reuse `league_chat` with a `channel = 'draft:<draft_id>'`, or a dedicated `draft_chat`; spec uses `league_chat.context`). Commissioner override actions auto-post a system message into draft chat (non-disable-able) — Sleeper-style transparency.
- **Mock draft (nice-to-have, Phase F):** a throwaway draft against CPU autopickers so a commissioner can test settings. Same engine, `drafts.is_mock = true`, no `league_rosters` written.

### 8.9 Draft references: your league-tagged lists in the room
The Live Draft Tool surfaces the user's league-tagged lists (§7.4) so their prep is usable on the clock.

- **"My Lists" panel** in the draft room (a tab beside *My Queue*): shows every list the user attached to this league, any **league-shared** lists, and their season Big Board by default.
- **Cheat sheet:** open any attached list (ranked, with tiers) in a side panel while drafting.
- **Overlay on the pool:** toggle a list as an overlay on Available Players — show each player's rank/tier from that list as a column, and/or **filter the pool to "only players on this list."**
- **Load into queue:** one tap to **load an attached list into the draft queue** in list order (skipping already-drafted players), or "Add remaining" to append; reorder afterward as normal.
- **Best available from my board:** an optional helper highlights the highest-ranked still-available player from the user's primary board.
- **Autopick tie-in:** if the user set a primary draft board (§7.4), autopick uses it before the generic Big Board (§8.4).
- **Live:** as players come off the board, overlays, queue, and "best available" update via the same `draft:<id>` Realtime channel.
- Mobile: the panel is a bottom sheet.

---

## 9. Real-time Architecture

Builds on the existing Supabase Realtime usage (`docs/02-TECHNICAL-ARCHITECTURE.md` §Real-time Features). Three Realtime mechanisms are used deliberately:

| Mechanism | Used for | Authoritative? |
|---|---|---|
| **Postgres Changes** (INSERT/UPDATE) | The truth: `drafts` state, new `draft_picks`, `matchups` score changes, `transactions`, `commissioner_actions` | **Yes** — clients re-render from DB rows |
| **Presence** | Who is currently in the draft room / online; per-team connection status; "on the clock" awareness | No (ephemeral) |
| **Broadcast** | Ephemeral UX: countdown ticks/heartbeats, "typing…", bid button pulses, optimistic bid echoes | No (ephemeral) |

**Channels**
- `draft:<draft_id>` — Postgres Changes on `drafts` + `draft_picks` (+ `draft_bids` for auction), Presence for room occupancy, Broadcast for clock heartbeat.
- `league:<league_id>` — Postgres Changes on `matchups`, `transactions`, `league_rosters`, `commissioner_actions`, `league_chat`; powers the league activity feed, standings, and the audit log live.
- Live scoring reuses the existing `player_stats` / `nfl_games` Realtime (Live Mode) — league matchup scores recompute client-side from those broadcasts and the league scoring system.

**Client rules**
- On join/reconnect: **fetch authoritative state via REST first**, render, *then* subscribe (never trust that you received every broadcast).
- Render countdowns from `current_deadline` (server timestamp) + local clock offset measured at subscribe time.
- All writes go through Route Handlers/RPCs; Realtime is read-only to clients (RLS forbids client writes to `draft_picks`, `matchups`, etc. — only `*_chat` inserts are allowed directly).

**RLS + Realtime note:** Realtime respects RLS. League tables are readable only by league members (policies in §12), so broadcasts naturally scope to the league. This is also why the audit log is *visible to members* — its SELECT policy allows all league members, while INSERT is restricted to commissioners via RPC.

---

## 10. Feature D — Commissioner Console + Audit Log (the differentiator)

**Product thesis:** *A commissioner can do anything a fantasy season might require — and the whole league can see exactly what they did and why.* Incumbents give power but hide it; FieldScout gives the same power with built-in accountability. This is the feature that earns trust and word-of-mouth.

### 10.1 Powers catalog (everything is allowed)
All actions live in the **Commissioner Console** (`/app/leagues/[id]/commish`) and the contextual inline controls (e.g., a "⚙ Commish" affordance on a matchup, roster, or transaction). Each requires a **reason** (free text, required) and writes a `commissioner_actions` row (§10.3). Co-commissioners have identical powers.

| Domain | Powers |
|---|---|
| **Matchups & results** | Edit either team's score for a week; **directly set the winner/loser/tie regardless of computed points** (Chris's headline use case — e.g., a team started an ineligible player); reopen a finalized week; recompute a week from current stats. |
| **Rosters & players** | Add/drop any player to/from any team (bypassing waivers/locks); **move a player from one team to another without a trade**; place/remove IR; edit a *past* week's starting lineup; bulk-fix after a stat correction. |
| **Transactions** | Approve/veto/force a pending trade; **reverse a completed trade**; cancel/redo a waiver claim; **edit any team's FAAB balance**; roll back any transaction. |
| **Standings & schedule** | Manually set a team's W/L/T record; edit the weekly schedule/matchups; assign byes; edit playoff seeds/bracket; set/break tiebreakers. |
| **Draft** | Everything in §8.7 (pause, undo, reassign, move, reset). |
| **League config** | Change any setting mid-season (with a warning about retroactive effects); change scoring (option to re-score prior weeks or not); change roster slots. |
| **Membership** | Reassign a team to a new manager; add/remove managers; promote/demote co-commissioners; convert a team to/from autopick/auto-manage. |
| **Lifecycle** | Move league status backward/forward (e.g., re-open the season; reset the draft). |

### 10.2 The illegal-/ineligible-player workflow (first-class)
Because no incumbent handles this well, FieldScout makes it a guided flow:
1. **Flag.** From a matchup or a team's lineup, the commissioner (or any manager, who can *report* — commissioner resolves) flags a start as ineligible per league rules (bye/OUT/suspended/positional/house-rule). Optional: attach the league rule text.
2. **Choose remedy.** The console offers: (a) zero-out the offending player's points, (b) set the matchup result directly (e.g., award the win to the opponent), (c) substitute the correct bench player and recompute, or (d) custom point adjustment.
3. **Reason required.** Prefilled with the flag context; commissioner can edit.
4. **Apply + log + announce.** State updates; a `commissioner_actions` entry with before/after is written; a system message posts to league chat and the league activity feed. Affected managers get a notification.

This turns a contentious manual chore into a transparent, defensible, two-click action.

### 10.3 The Audit Log (`commissioner_actions`) — design
The heart of the differentiator. **Append-only, immutable, league-visible.**

- **Captured per action:** `id`, `league_id`, `actor_id` (commish/co-commish), `action_type` (enum), `target_type` + `target_id` (e.g., matchup, team, trade, player, draft_pick, setting), `reason` (required, non-empty), `before` JSONB, `after` JSONB, `metadata` JSONB (e.g., week, affected_team_ids), `created_at`. Optionally `is_reverted` + `reverted_by_action_id` for chained undo.
- **Immutability:** no UPDATE/DELETE allowed by anyone (enforced by RLS: only INSERT for commissioners; no UPDATE/DELETE policy exists, so they're denied). "Undoing" an override is itself a *new* logged action that references the original — the original entry is never erased. (This is explicitly better than MFL, where records can be deleted.)
- **Visibility:** SELECT policy = any league member. Rendered as a human-readable, filterable **League Activity → Commissioner Actions** timeline: "{actor} changed Week 7: Team A 98.4 → set result to Team B win — reason: 'Started ineligible player (bye)'. 2h ago. [view diff]".
- **Transparency guarantees:** override system messages auto-post to league chat and **cannot be disabled** (Sleeper-style). A small "✸ adjusted by commissioner" badge appears on any matchup/score/roster that was overridden, linking to the log entry.
- **Tamper-evidence (stretch, Phase F):** each row stores a hash chain (`prev_hash`, `row_hash = hash(prev_hash + canonical(row))`) so the league can verify the log was never altered. Marked optional in §18 phasing.
- **Scope:** *every* override across the app funnels through one logging helper (`logCommissionerAction()`), called inside the same transaction as the change so a state change can never be written without its log entry (enforced by routing all overrides through RPCs that write both).

### 10.4 Guardrails (kept light, per product choice "Full power + audit log")
- **Reason required** on every override (the only hard friction).
- **Confirmation dialogs** on destructive/cascade actions (reset draft, reverse trade, set result) showing the before/after.
- **Undo** available on most overrides (writes a new compensating logged action).
- No approval workflow, no rate limits, no hidden actions. Power is unrestricted by design; the log is the accountability.

---

## 11. Feature C — In-Season Operations

### 11.1 Rosters & player exclusivity
- After the draft, `league_rosters` holds every (league, team, player) ownership with the slot it occupies and acquisition metadata. This is the in-league analogue of `team_players` from `spec-leagues-live-mode.md`, made authoritative here.
- **Exclusivity:** a `UNIQUE(league_id, player_id)` constraint guarantees an NFL player is on at most one team per league (matches existing business rule #7 in `CLAUDE.md`). All add/claim/trade paths must respect it; the commissioner move-player tool is the only way to forcibly reassign (and it swaps atomically).
- **Roster legality:** a helper validates a roster/lineup against the league slot config (`roster_settings.starting_slots[].eligible`) and player eligibility. Because a league can define several overlapping flex slots, validation does a **bipartite match** of started players → slots (each player fills exactly one slot — e.g., a lone WR can't satisfy both a W/T and a W/R/T) and reports any unfillable slot. Illegal rosters are blocked on normal actions (unless `allow_illegal_lineups`), but never block the commissioner.

### 11.2 Weekly lineups & lock
- Reuse/extend `team_lineups` (already `UNIQUE(team_id, season, week)`, with `starters`/`bench` JSONB). Add slot mapping so a starter is tied to a specific `slot_key`.
- Managers set starters before lock. **Lock** per `lineup_lock` setting (default per-player kickoff; alt first-game-of-week). Locked slots are read-only to managers.
- **Auto-carry:** if a manager doesn't set a lineup, last week's legal lineup carries over (invalid/bye players flagged).
- **IR moves:** a player can be placed on an IR spot only while holding one of that spot's eligible designations; on placement set `ir_placed_week` (and, for **Restricted** IR, `ir_lock_until_week = ir_placed_week + min_weeks`). Moving a player **out of a Restricted IR** spot is blocked until `current_week ≥ ir_lock_until_week`; **Unrestricted** IR allows free in/out before lock. If an IR'd player loses eligibility, the roster is flagged illegal until they're moved off (Restricted stint still applies; commissioner can override). See §7.3.2 / §12.7.
- **Swap spot:** a manager may arm one swap per swap spot — a same-position bench player that auto-starts if the protected starter is ruled out pre-game or in-game (§7.3.2). Editable until the swap's lock (first Sunday kickoff, or Thursday if a Thursday player is involved), then armed; the `process-swaps` worker (§14) executes it. Stored in `lineup_swaps` (§12.16).
- Commissioner can edit any lineup, including **retroactively** and past lock (audited) — the mechanism behind §10.2.

### 11.3 Auto-sub inactives (optional)
- If `auto_sub_inactives` is on: ~90 min before a starter's kickoff, if the player is officially OUT/inactive (from `players.status` / injury feed) and a *legal, playing* bench replacement exists, auto-swap them and record it (visible to the manager, logged as a system — not commissioner — action). Off by default; mirrors Sleeper's free auto-sub (a feature ESPN/Yahoo lack and NFL.com paywalls).

### 11.4 Scoring, matchups & live updates
- **Schedule generation:** on draft completion (or when entering `in_season`), generate a round-robin H2H schedule across `regular_season_weeks` honoring divisions; store as `matchups` rows (one per pairing per week). Commissioner-editable.
- **Live scoring:** a matchup's team score = Σ fantasy points of that team's locked starters for the week, computed via `src/utils/calculate-fantasy-points.ts` against the league `scoring_system_id`, fed by the Live Mode pipeline (`player_stats` realtime). Matchup view reuses Live Mode patterns (Now Playing / Done / Up Next).
- **Swap resolution:** if a team armed a Swap spot (§7.3.2) and it triggers, the effective starter for that slot becomes the swap-in player (pre-game inactive) or the greater-of result (in-game injury); live scoring and finalization use the resolved slot.
- **Finalization:** after the week's games + the stat-correction window (configurable, default Wednesday — see §14), the matchup is marked `final`, W/L/T assigned, standings updated. A `final` matchup is only changed via a commissioner override (§10).
- **Stat corrections:** when the stats pipeline applies an official correction within the window, affected non-final matchups recompute automatically; the league sees a system note. *(Avoid the ESPN double-credit trap: never let a manual override and an automatic correction both apply — overrides set an absolute value or are tagged to suppress auto-recompute for that cell.)*

### 11.5 Standings & playoffs
- **Standings:** computed from final matchups; ordered by the tiebreaker chain (§7.3.7). Live "projected standings" shown during a week.
- **Divisions:** if 2, standings shown per division + overall; seeding rules configurable (division winners seeded first, optional).
- **Playoffs:** when `playoff_start_week` arrives, generate the bracket from seeds (byes for top seeds when bracket > `playoff_teams`); `playoff_reseed` controls per-round reseeding; optional consolation + third-place. Bracket is commissioner-editable. Champion recorded on `complete`.

### 11.6 History Mode (carry-over from existing PRD §F9)
- Preserve the existing **History Mode** concept (per-season records, H2H history between any two teams, avg points/week, win %). In this model it's simply derived from the persisted `matchups`/`league_rosters`/standings for completed seasons; expose it on a league History tab. (The original $5/yr monetization is a product decision — see Open Questions; the data is retained regardless so it can be unlocked retroactively.)

---

## 12. Data Model

Conventions match `docs/03-DATA-MODEL.md`: UUID PKs, `snake_case`, `TIMESTAMPTZ DEFAULT NOW()`, RLS on every table, JSONB for flexible config, soft deletes where user-facing. Ship as ordered migrations (suggested `supabase/migrations/0XX_*.sql`). This **supersedes the thin `leagues`/`league_chat` schema** in `spec-leagues-live-mode.md` — a migration alters the existing `leagues` table rather than recreating it.

### 12.0 Shared RLS helper functions
Keep policies readable and fast.

```sql
-- Is the current user a member (any role) of the league?
CREATE OR REPLACE FUNCTION is_league_member(p_league_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid()
  );
$$;

-- Is the current user a commissioner or co-commissioner of the league?
CREATE OR REPLACE FUNCTION is_league_commish(p_league_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid()
      AND m.role IN ('commissioner','co_commissioner')
  );
$$;
```

### 12.1 `leagues` (ALTER existing)
```sql
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'setup',
    -- setup | scheduled | drafting | in_season | playoffs | complete
  ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'redraft',
  ADD COLUMN IF NOT EXISTS team_count INTEGER NOT NULL DEFAULT 12
    CHECK (team_count IN (8,10,12,14,16,18,20)),
  ADD COLUMN IF NOT EXISTS regular_season_weeks INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS playoff_teams INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS playoff_start_week INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS waiver_type TEXT NOT NULL DEFAULT 'faab',
  ADD COLUMN IF NOT EXISTS faab_budget INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS trade_review TEXT NOT NULL DEFAULT 'commissioner',
  ADD COLUMN IF NOT EXISTS trade_deadline_week INTEGER,
  ADD COLUMN IF NOT EXISTS lineup_lock TEXT NOT NULL DEFAULT 'per_player_kickoff',
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}',
    -- long-tail config: divisions, playoff_weeks_per_round, reseed, consolation,
    -- tiebreakers[], waiver_process_day, acquisition caps, trade settings,
    -- auto_sub_inactives, allow_illegal_lineups, draft config block, etc.
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
-- NOTE: existing columns reused: id, owner_id (the commissioner), name, description,
--   max_teams (kept in sync with team_count), scoring_system_id, roster_settings (slots),
--   invite_code, is_active, season, created_at, updated_at.
```
RLS already exists ("viewable by members", "owners can manage"); **replace** the member-check policy to use `league_members` (the old policy keyed off `teams.league_id`):
```sql
DROP POLICY IF EXISTS "Leagues are viewable by members" ON leagues;
CREATE POLICY "Leagues viewable by members"
  ON leagues FOR SELECT
  USING (is_league_member(id) OR owner_id = auth.uid());
-- keep "League owners can manage"; add co-commish management via RPCs (SECURITY DEFINER).
```

### 12.2 `league_members`
```sql
CREATE TABLE league_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,   -- NULL for an unclaimed placeholder seat
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,     -- the manager's roster in this league
  role TEXT NOT NULL DEFAULT 'manager',                     -- commissioner | co_commissioner | manager
  is_placeholder BOOLEAN DEFAULT FALSE,
  is_autodraft BOOLEAN DEFAULT FALSE,
  faab_balance INTEGER,                                    -- in-season FAAB remaining; seeded from leagues.faab_budget on join
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, user_id),
  UNIQUE(league_id, team_id)
);
ALTER TABLE league_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members viewable by league members"
  ON league_members FOR SELECT USING (is_league_member(league_id));
CREATE POLICY "Commish manages members"
  ON league_members FOR ALL USING (is_league_commish(league_id));
CREATE INDEX idx_league_members_league ON league_members(league_id);
CREATE INDEX idx_league_members_user ON league_members(user_id);
```

### 12.3 `drafts`
```sql
CREATE TABLE drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  draft_type TEXT NOT NULL DEFAULT 'snake',        -- snake | auction | linear
  status TEXT NOT NULL DEFAULT 'scheduled',        -- scheduled | live | paused | complete
  is_mock BOOLEAN DEFAULT FALSE,
  config JSONB NOT NULL DEFAULT '{}',              -- snapshot of draft settings (§7.3.8) at scheduling
  draft_order JSONB,                               -- ordered array of team_ids (snake/linear)
  nomination_order JSONB,                          -- ordered array of team_ids (auction)
  total_rounds INTEGER,                            -- derived from roster_size (snake)
  current_round INTEGER DEFAULT 1,
  current_pick_number INTEGER DEFAULT 1,           -- 1-based overall pick index
  on_clock_team_id UUID REFERENCES teams(id),      -- team currently picking / nominating
  current_nomination JSONB,                        -- auction: { player_id, high_bid, high_bidder_team_id }
  current_deadline TIMESTAMPTZ,                    -- server-authoritative clock end
  paused_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Drafts viewable by league members"
  ON drafts FOR SELECT USING (is_league_member(league_id));
-- No client write policy: all writes via SECURITY DEFINER RPCs.
CREATE INDEX idx_drafts_league ON drafts(league_id);
CREATE INDEX idx_drafts_active ON drafts(status) WHERE status IN ('live','paused');
```

### 12.4 `draft_picks`
```sql
CREATE TABLE draft_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES drafts(id) ON DELETE CASCADE NOT NULL,
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  pick_number INTEGER NOT NULL,                    -- overall pick index (snake/linear); sequence # (auction)
  round INTEGER,
  team_id UUID REFERENCES teams(id) NOT NULL,
  player_id TEXT REFERENCES players(id) NOT NULL,  -- players.id is TEXT (Sleeper id) per Phase 0 schema
  price INTEGER,                                   -- auction winning bid; NULL for snake
  is_auto BOOLEAN DEFAULT FALSE,                   -- autopicked
  is_undone BOOLEAN DEFAULT FALSE,                 -- soft-undo (kept for audit)
  picked_by UUID REFERENCES profiles(id),          -- the user who made it (manager or commissioner)
  made_via TEXT DEFAULT 'manager',                 -- manager | autopick | commissioner
  action_id UUID,                                  -- client-generated; dedupes retries (NULL for system/cron picks)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE draft_picks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Picks viewable by league members"
  ON draft_picks FOR SELECT USING (is_league_member(league_id));
-- exclusivity within a draft (ignores undone picks):
CREATE UNIQUE INDEX uniq_draft_player_live
  ON draft_picks(draft_id, player_id) WHERE is_undone = FALSE;
CREATE UNIQUE INDEX uniq_draft_action            -- enforces idempotency (replay-safe picks)
  ON draft_picks(draft_id, action_id) WHERE action_id IS NOT NULL;
CREATE INDEX idx_draft_picks_draft ON draft_picks(draft_id, pick_number);
```

### 12.5 `draft_bids` (auction)
```sql
CREATE TABLE draft_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES drafts(id) ON DELETE CASCADE NOT NULL,
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,  -- stored for a simple RLS policy
  nomination_seq INTEGER NOT NULL,                 -- which nomination this bid belongs to
  player_id TEXT REFERENCES players(id) NOT NULL,
  team_id UUID REFERENCES teams(id) NOT NULL,
  amount INTEGER NOT NULL,
  action_id UUID NOT NULL,                          -- client-generated; dedupes retries (idempotency)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(draft_id, action_id)
);
ALTER TABLE draft_bids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Bids viewable by league members"
  ON draft_bids FOR SELECT USING (is_league_member(league_id));
CREATE INDEX idx_draft_bids_nom ON draft_bids(draft_id, nomination_seq, amount DESC);
```

### 12.6 `draft_queues`
```sql
CREATE TABLE draft_queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES drafts(id) ON DELETE CASCADE NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  player_id TEXT REFERENCES players(id) NOT NULL,
  rank INTEGER NOT NULL,                            -- order within this team's queue
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(draft_id, team_id, player_id)
);
ALTER TABLE draft_queues ENABLE ROW LEVEL SECURITY;
-- A manager sees/edits only their own queue; commissioners can read all (for autopick debugging).
CREATE POLICY "Own queue read" ON draft_queues FOR SELECT
  USING (EXISTS (SELECT 1 FROM teams t WHERE t.id = team_id AND t.owner_id = auth.uid()));
CREATE POLICY "Own queue write" ON draft_queues FOR ALL
  USING (EXISTS (SELECT 1 FROM teams t WHERE t.id = team_id AND t.owner_id = auth.uid()));
CREATE INDEX idx_draft_queues_team ON draft_queues(draft_id, team_id, rank);
```

### 12.7 `league_rosters` (in-league player ownership)
```sql
CREATE TABLE league_rosters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  player_id TEXT REFERENCES players(id) NOT NULL,
  slot_key TEXT,                                   -- current slot assignment for the active week (qb, rb, flex, bn, ir, ...)
  acquisition_type TEXT DEFAULT 'draft',           -- draft | waiver | free_agent | trade | commissioner
  acquisition_cost INTEGER DEFAULT 0,              -- FAAB/auction spend if applicable
  ir_placed_week INTEGER,                          -- NFL week the player entered an IR spot (NULL if not on IR)
  ir_lock_until_week INTEGER,                      -- restricted IR: earliest week the manager may remove them (NULL = unrestricted / not on IR)
  acquired_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, player_id)                     -- ENFORCES player exclusivity within a league
);
ALTER TABLE league_rosters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Rosters viewable by league members"
  ON league_rosters FOR SELECT USING (is_league_member(league_id));
-- Writes via RPCs (add/drop/trade/commish move) so exclusivity + caps are enforced atomically.
CREATE INDEX idx_league_rosters_team ON league_rosters(team_id);
CREATE INDEX idx_league_rosters_league ON league_rosters(league_id);
```

### 12.8 `matchups`
```sql
CREATE TABLE matchups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  round_type TEXT DEFAULT 'regular',               -- regular | playoff | consolation | third_place
  home_team_id UUID REFERENCES teams(id) NOT NULL,
  away_team_id UUID REFERENCES teams(id),          -- NULL = bye
  home_score NUMERIC DEFAULT 0,
  away_score NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'scheduled',                 -- scheduled | live | final
  result TEXT,                                     -- home | away | tie  (computed OR overridden)
  is_overridden BOOLEAN DEFAULT FALSE,             -- TRUE if a commissioner set the result/score
  override_action_id UUID,                         -- FK → commissioner_actions(id)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, season, week, home_team_id)
);
ALTER TABLE matchups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Matchups viewable by league members"
  ON matchups FOR SELECT USING (is_league_member(league_id));
CREATE INDEX idx_matchups_league_week ON matchups(league_id, season, week);
```

### 12.9 `transactions` (unified in-season activity)
```sql
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,                              -- add | drop | add_drop | waiver_claim | trade | commissioner_move
  status TEXT NOT NULL DEFAULT 'complete',         -- pending | complete | reversed | failed | vetoed
  initiator_team_id UUID REFERENCES teams(id),     -- NULL when commissioner-initiated
  initiated_by UUID REFERENCES profiles(id),
  payload JSONB NOT NULL,                          -- normalized: players in/out, teams, faab, slot, etc.
  related_action_id UUID,                          -- FK → commissioner_actions(id) when applicable
  week INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Transactions viewable by league members"
  ON transactions FOR SELECT USING (is_league_member(league_id));
CREATE INDEX idx_transactions_league ON transactions(league_id, created_at DESC);
```

### 12.10 `waiver_claims`
```sql
CREATE TABLE waiver_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  add_player_id TEXT REFERENCES players(id) NOT NULL,
  drop_player_id TEXT REFERENCES players(id),       -- optional corresponding drop
  faab_bid INTEGER DEFAULT 0,                        -- blind bid
  priority INTEGER,                                  -- for rolling/reverse modes
  status TEXT DEFAULT 'pending',                     -- pending | won | lost | invalid | cancelled
  process_at TIMESTAMPTZ,                            -- when the batch runs
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE waiver_claims ENABLE ROW LEVEL SECURITY;
-- Own claims private until processed (blind bids must not leak); commissioners can see all.
CREATE POLICY "Own or commish claims read" ON waiver_claims FOR SELECT
  USING (
    is_league_commish(league_id)
    OR EXISTS (SELECT 1 FROM teams t WHERE t.id = team_id AND t.owner_id = auth.uid())
  );
CREATE POLICY "Own claims write" ON waiver_claims FOR ALL
  USING (EXISTS (SELECT 1 FROM teams t WHERE t.id = team_id AND t.owner_id = auth.uid()));
CREATE INDEX idx_waiver_claims_proc ON waiver_claims(league_id, process_at) WHERE status = 'pending';
```
> FAAB balances live on `league_members` or a small `team_faab(team_id, balance)` view/column; spec stores `faab_balance INTEGER` on `league_members` (decremented atomically on a won claim).

### 12.11 `trades` + `trade_items`
```sql
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  proposer_team_id UUID REFERENCES teams(id) NOT NULL,
  recipient_team_id UUID REFERENCES teams(id) NOT NULL,
  status TEXT DEFAULT 'proposed',                   -- proposed | accepted | rejected | cancelled | in_review | vetoed | complete | reversed
  review_deadline TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE TABLE trade_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID REFERENCES trades(id) ON DELETE CASCADE NOT NULL,
  from_team_id UUID REFERENCES teams(id) NOT NULL,
  to_team_id UUID REFERENCES teams(id) NOT NULL,
  player_id TEXT REFERENCES players(id),            -- a player OR faab
  faab_amount INTEGER                               -- when trading FAAB (if allowed)
);
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trades viewable by league members"
  ON trades FOR SELECT USING (is_league_member(league_id));
CREATE POLICY "Trade items viewable by league members"
  ON trade_items FOR SELECT USING (
    is_league_member((SELECT league_id FROM trades WHERE trades.id = trade_id))
  );
-- Proposing/accepting via RPCs that validate rosters + exclusivity.
```

### 12.12 `commissioner_actions` (the audit log — immutable)
```sql
CREATE TABLE commissioner_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  actor_id UUID REFERENCES profiles(id) NOT NULL,
  action_type TEXT NOT NULL,
    -- e.g. edit_score | set_result | move_player | force_add | force_drop |
    --      reverse_trade | force_trade | edit_faab | edit_standings | edit_schedule |
    --      edit_lineup | draft_undo | draft_reassign | draft_reset | change_setting |
    --      reassign_team | promote_member | reopen_week | lifecycle_change
  target_type TEXT,                                 -- matchup | team | player | trade | draft_pick | setting | member | schedule
  target_id TEXT,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),  -- reason is mandatory
  before JSONB,
  after JSONB,
  metadata JSONB,                                   -- { week, affected_team_ids[], ... }
  reverts_action_id UUID REFERENCES commissioner_actions(id),  -- if this undoes a prior action
  prev_hash TEXT,                                   -- optional tamper-evidence chain (Phase F)
  row_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE commissioner_actions ENABLE ROW LEVEL SECURITY;
-- VISIBLE TO ALL MEMBERS (transparency); INSERT only by commissioners; NO update/delete policies = immutable.
CREATE POLICY "Audit log readable by all league members"
  ON commissioner_actions FOR SELECT USING (is_league_member(league_id));
CREATE POLICY "Only commish can append"
  ON commissioner_actions FOR INSERT WITH CHECK (is_league_commish(league_id) AND actor_id = auth.uid());
CREATE INDEX idx_commish_actions_league ON commissioner_actions(league_id, created_at DESC);
```
> Because there is **no** UPDATE or DELETE policy, even a commissioner cannot alter or remove an entry — Postgres denies it. Every override RPC inserts here in the same transaction as the state change (a state change without its log entry is impossible). Add `matchups.override_action_id` / `transactions.related_action_id` FKs → this table (added in Phase E, after this table exists). **Caveat:** RLS does not restrict Supabase's `service_role`/admin, which bypasses RLS — so the optional hash chain (§10.3) is the real defense against privileged writes, and a DB trigger on overridable tables (requiring a matching log row) is a recommended backstop so no future code path can change state without logging.

### 12.13 `team_lineups` (extend existing) & `league_chat` (extend existing)
```sql
-- team_lineups already: (team_id, season, week, starters JSONB, bench JSONB, total_points, set_at)
ALTER TABLE team_lineups
  ADD COLUMN IF NOT EXISTS slot_map JSONB,           -- { "<slot_key>": "<player_id>" }; keys are the unique roster_settings.starting_slots[].key (multiple flex slots stay distinct)
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edited_by_commish BOOLEAN DEFAULT FALSE;

-- league_chat already: (league_id, user_id, message, created_at). Add a context to support draft chat + system posts.
ALTER TABLE league_chat
  ADD COLUMN IF NOT EXISTS context TEXT DEFAULT 'league',   -- 'league' | 'draft:<draft_id>'
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE; -- system posts for commissioner actions (non-deletable)
```

### 12.14 Realtime publication
Add the league/draft tables to the `supabase_realtime` publication so Postgres Changes broadcast:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE
  drafts, draft_picks, draft_bids, matchups, transactions,
  league_rosters, commissioner_actions, league_chat, league_lists, lineup_swaps;
```

### 12.15 `league_lists` (attach ranking lists to a league)
```sql
CREATE TABLE league_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  list_id UUID REFERENCES lists(id) ON DELETE CASCADE NOT NULL,
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,  -- member who attached it (matches lists.owner_id)
  is_primary_board BOOLEAN DEFAULT FALSE,        -- feeds this member's queue/autopick for the league
  shared_with_league BOOLEAN DEFAULT FALSE,      -- visible to all members (else owner-only)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, list_id, owner_id)
);
-- at most one primary board per member per league:
CREATE UNIQUE INDEX uniq_primary_board_per_member
  ON league_lists(league_id, owner_id) WHERE is_primary_board = TRUE;
CREATE INDEX idx_league_lists_member ON league_lists(league_id, owner_id);

ALTER TABLE league_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own or shared league-list links readable"
  ON league_lists FOR SELECT USING (
    owner_id = auth.uid()
    OR (shared_with_league = TRUE AND is_league_member(league_id))
  );
CREATE POLICY "Members manage their own attachments"
  ON league_lists FOR ALL USING (owner_id = auth.uid() AND is_league_member(league_id));
```
> **Shared-private lists:** the existing `lists` RLS allows public read + owner read. To let members open a list that is **shared but private** in the draft room, add a SELECT policy on `lists` permitting read when a `league_lists` row links it to a league the viewer belongs to with `shared_with_league = TRUE`. Public lists are already readable, so this only matters for private shares.

### 12.16 `lineup_swaps` (Swap spot auto-substitution)
```sql
CREATE TABLE lineup_swaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  out_player_id TEXT REFERENCES players(id) NOT NULL,   -- the starter being protected
  in_player_id TEXT REFERENCES players(id) NOT NULL,    -- the bench player that auto-starts
  slot_key TEXT NOT NULL,                               -- the exact starting slot the out player occupies
  position TEXT NOT NULL,                               -- exact position shared by both players (RB, WR, ...)
  status TEXT NOT NULL DEFAULT 'armed',                 -- armed | triggered | inactive
  trigger_type TEXT,                                    -- pregame_inactive | ingame_injury | none
  armed_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,                                -- first Sunday kickoff, or Thursday if a Thursday player is involved
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, season, week)                        -- one swap per team per week
);
ALTER TABLE lineup_swaps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Swaps viewable by league members"
  ON lineup_swaps FOR SELECT USING (is_league_member(league_id));
CREATE POLICY "Team owner manages own swaps"
  ON lineup_swaps FOR ALL USING (
    EXISTS (SELECT 1 FROM teams t WHERE t.id = team_id AND t.owner_id = auth.uid())
  );
CREATE INDEX idx_lineup_swaps_week ON lineup_swaps(league_id, season, week);
```
> Enforce in the API: one swap row per (team, season, week) when the Swap spot is on (`swap_spots = 1`); the *out* player must be a current starter and the *in* player on the bench with the **same `player.position`**; edits allowed only before `locked_at`. The auto-sub itself is performed by the `process-swaps` worker (§14), which sets `status`/`trigger_type`/`triggered_at` and writes a `transactions` row (`type='auto_swap'`).

---

## 13. Transactions — Waivers, FAAB, Trades & Free Agency

### 13.1 Add / drop & free agency
- Managers add an unowned player (FCFS after waivers clear) and drop one to stay within `roster_size`. Validates exclusivity (`league_rosters` unique), roster legality, lock state, and acquisition caps. Writes a `transactions` row (`type='add_drop'`) and updates `league_rosters`.
- Dropped players enter waivers for `waiver_period_hours` (unless `none_fcfs`).

### 13.2 Waivers & FAAB (blind bid)
- Managers submit `waiver_claims` (add + optional drop + `faab_bid`), private until processed (RLS).
- A scheduled **`process-waivers`** job (per league `waiver_process_day`/time, §14) resolves all pending claims for the league atomically:
  - **FAAB:** highest bid wins each contested player; ties broken by `faab_tiebreaker` (`reverse_standings` or `rolling_priority`); winner's `faab_balance` decremented; exclusivity enforced; cascading claims (a team's 2nd claim only if 1st failed) supported via per-team claim groups/priority.
  - **Rolling/reverse priority:** no money; lowest priority number wins; winner drops to the back (rolling) or order resets by reverse standings.
  - Each resolved claim writes a `transactions` row and updates `league_rosters`; losers marked `lost`.
- FAAB balance shown on the team page and standings; **commissioner can edit any balance** (audited, §10).

### 13.3 Trades
- **Propose:** proposer selects players (and FAAB if `allow_faab_in_trades`) both ways → `trades` + `trade_items`. Validates both rosters would remain legal post-trade.
- **Accept/reject:** recipient responds. On accept, enter review per `trade_review`:
  - `none` → execute immediately.
  - `commissioner` → pending until commissioner approves/vetoes (or `trade_review_period_hours` elapses → auto-approve).
  - `league_vote` → members vote; `trade_veto_votes` against → vetoed; else execute at deadline.
- **Execute:** atomic swap in `league_rosters` (exclusivity preserved), FAAB transfers if applicable, `transactions` row (`type='trade'`, `status='complete'`), trade marked complete. Realtime + notifications fire.
- **Deadline:** blocked after `trade_deadline_week`.
- **Commissioner overrides:** force-approve, veto, or **reverse a completed trade** (restores both rosters atomically) — each audited (§10). Reversal is a true one-click action (better than ESPN/MFL, which require manual roster rebuilds).

### 13.4 Activity feed
- The `league:<id>` channel + `transactions` + `commissioner_actions` power a unified **League Activity** feed (adds, drops, waivers, trades, draft, and — clearly labeled — commissioner actions), with filters. Commissioner actions render with the "✸ commissioner" treatment and link to the audit entry.

---

## 14. Background Jobs & Scheduled Functions

Follows the existing Edge Function + pg_cron pattern (`docs/02-TECHNICAL-ARCHITECTURE.md` §Cron Jobs). New jobs:

| Job | Schedule | Responsibility |
|---|---|---|
| `draft-tick` | every ~5s **while any draft is `live`** (self-gating; no-op otherwise) | Enforce `current_deadline`: autopick (snake/linear) or close the bid / advance nomination (auction); set next deadline; broadcast via row update. Self-reschedules immediately after each user action for tight timing. |
| `process-waivers` | per-league cadence (default Wed 3:00am local) | Resolve pending `waiver_claims` atomically (§13.2). |
| `finalize-matchups` | after each NFL week + the stat-correction window (default Wed) | Mark matchups `final`, assign W/L/T, update standings; respects overrides (never recompute an overridden cell). |
| `trade-review-expiry` | every 15 min | Auto-resolve trades whose review window elapsed. |
| `lineup-lock` | every 1 min on game days | Lock slots per `lineup_lock`; arm swaps at lock; optional `auto_sub_inactives` (§11.3). |
| `process-swaps` | game windows (rides `sync-live-stats`, ~30s) | Fire armed **Swap spots** (§7.3.2): pre-game when the *out* player is inactive at kickoff, in-game when ruled out mid-game; set `lineup_swaps` status, credit the slot per the resolution rule, write a `transactions` (`auto_swap`) row, broadcast to the live matchup. |
| live scoring | reuse existing `sync-live-stats` (30s in game windows) | Feeds matchup live scores via `player_stats`/`nfl_games` Realtime; no new job. |

**Authoritative-clock principle:** the draft is correct even if all clients are offline because `draft-tick` enforces deadlines server-side. All money/exclusivity-affecting jobs run inside transactions using the same RPC validators as user actions.

---

## 15. API Surface

All mutations are Route Handlers (`app/api/...`, kebab-case) per `CLAUDE.md`; Zod-validate every input. Concurrency-critical draft/transaction logic lives in Postgres **RPCs** (`SECURITY DEFINER`) the handlers call inside a transaction, so the same validation runs whether triggered by a user or a cron job.

### 15.1 League & membership
```
POST   /api/leagues                         create league (Pro-gated)
GET    /api/leagues                         my leagues
GET    /api/leagues/[id]                    league detail (members, settings, status)
PATCH  /api/leagues/[id]                    update settings (commish; structural changes post-draft are overrides)
DELETE /api/leagues/[id]                    soft delete (commish)
POST   /api/leagues/[id]/invite             create/refresh invite code; send invites
POST   /api/leagues/join                    join via invite code (free)
POST   /api/leagues/[id]/members           add placeholder seat (commish)
PATCH  /api/leagues/[id]/members/[mid]      role change / reassign team / toggle autodraft (commish)
DELETE /api/leagues/[id]/members/[mid]      remove member (commish)
```

### 15.2 Draft
```
POST   /api/leagues/[id]/draft              create/schedule draft from settings (commish)
PATCH  /api/leagues/[id]/draft              edit draft config / order (commish)
POST   /api/leagues/[id]/draft/start        start (commish)            → rpc draft_start
POST   /api/leagues/[id]/draft/pick         make a pick                → rpc draft_make_pick(action_id, player_id)
POST   /api/leagues/[id]/draft/nominate     auction nominate           → rpc draft_nominate(...)
POST   /api/leagues/[id]/draft/bid          auction bid                → rpc draft_place_bid(...)
POST   /api/leagues/[id]/draft/queue        upsert my queue
POST   /api/leagues/[id]/draft/autodraft    toggle autodraft for my team
-- Commissioner live controls (each → rpc + commissioner_actions insert):
POST   /api/leagues/[id]/draft/pause        rpc draft_pause / draft_resume
POST   /api/leagues/[id]/draft/undo         rpc draft_undo(to_pick_number?)   (single or cascade)
POST   /api/leagues/[id]/draft/reassign     rpc draft_reassign_pick(pick_id, team_id|player_id)
POST   /api/leagues/[id]/draft/force-pick   rpc draft_force_pick(team_id, player_id)
POST   /api/leagues/[id]/draft/move-player  rpc draft_move_player(player_id, from_team, to_team)
POST   /api/leagues/[id]/draft/reset        rpc draft_reset
```
**Key RPCs (server-authoritative):** `draft_make_pick`, `draft_place_bid`, `draft_nominate`, `draft_tick` (timer worker), `draft_undo`, `draft_reassign_pick`, `draft_move_player`, `draft_reset`. Each: lock `drafts` row → validate → write → advance → set `current_deadline` → (commish actions) insert `commissioner_actions`.

### 15.3 In-season
```
GET    /api/leagues/[id]/rosters            all rosters
PATCH  /api/leagues/[id]/teams/[tid]/lineup set weekly lineup (slot_map)     → rpc set_lineup
POST   /api/leagues/[id]/teams/[tid]/swap   set/clear this week's Swap (out + in players) → rpc set_swap
POST   /api/leagues/[id]/transactions       add/drop / free agent            → rpc roster_add_drop
POST   /api/leagues/[id]/waivers            submit waiver claim (blind)
GET    /api/leagues/[id]/waivers            my pending claims
POST   /api/leagues/[id]/trades             propose trade
PATCH  /api/leagues/[id]/trades/[tid]       accept/reject/cancel/vote
GET    /api/leagues/[id]/matchups?week=     matchups + live scores
GET    /api/leagues/[id]/standings          standings (tiebreaker-ordered)
GET    /api/leagues/[id]/activity           unified activity feed (incl. audit)
```

### 15.4 Commissioner overrides (all require `reason`; all write `commissioner_actions`)
```
POST   /api/leagues/[id]/commish/score          rpc commish_edit_score(matchup_id, home, away, reason)
POST   /api/leagues/[id]/commish/result         rpc commish_set_result(matchup_id, winner, reason)
POST   /api/leagues/[id]/commish/move-player    rpc commish_move_player(player_id, from, to, reason)
POST   /api/leagues/[id]/commish/roster         rpc commish_force_add_drop(...)
POST   /api/leagues/[id]/commish/lineup         rpc commish_edit_lineup(team, week, slot_map, reason)
POST   /api/leagues/[id]/commish/trade          rpc commish_force_or_reverse_trade(trade_id, op, reason)
POST   /api/leagues/[id]/commish/faab           rpc commish_edit_faab(team_id, balance, reason)
POST   /api/leagues/[id]/commish/standings      rpc commish_edit_record(team_id, w, l, t, reason)
POST   /api/leagues/[id]/commish/schedule       rpc commish_edit_schedule(...)
POST   /api/leagues/[id]/commish/setting        rpc commish_change_setting(key, value, rescore?, reason)
POST   /api/leagues/[id]/commish/flag-illegal   guided illegal-lineup remedy (§10.2)
GET    /api/leagues/[id]/commish/log            audit log (any member can read)
```

### 15.5 League-tagged lists & draft references
```
POST   /api/leagues/[id]/lists                      attach one of my lists to this league
GET    /api/leagues/[id]/lists                      my attached lists (+ league-shared)
PATCH  /api/leagues/[id]/lists/[llid]               set primary board / toggle shared
DELETE /api/leagues/[id]/lists/[llid]               detach
POST   /api/leagues/[id]/draft/queue/from-list/[listId]   load an attached list into my draft queue
```

### 15.6 Hooks (React Query)
`src/hooks/`: `use-league.ts`, `use-leagues.ts`, `use-league-members.ts`, `use-draft.ts` (subscribes to `draft:<id>`), `use-draft-queue.ts`, `use-league-lists.ts`, `use-rosters.ts`, `use-lineup.ts`, `use-swaps.ts`, `use-waivers.ts`, `use-trades.ts`, `use-matchups.ts`, `use-standings.ts`, `use-league-activity.ts`, `use-commish.ts`. Optimistic updates for queue reorder, lineup set, chat, like-style toggles; **never** optimistic for picks/bids/trades (server-authoritative — reflect the broadcast).

---

## 16. UI / Screens / Components

Follows `docs/06-DESIGN-SYSTEM.md` (dark, Spotify-green accent, Inter, dense player rows, tier colors) and `docs/07-NAVIGATION-ARCHITECTURE.md` (Leagues nav item is Pro). Mobile-first; drag-and-drop must work on touch (reuse `@dnd-kit`).

### 16.1 Routes (App Router)
```
src/app/(app)/leagues/page.tsx                      My Leagues (list + Create)
src/app/(app)/leagues/new/page.tsx                  Create wizard (settings §7.3)
src/app/(app)/leagues/[id]/page.tsx                 League home (matchup of the week, standings peek, activity)
src/app/(app)/leagues/[id]/settings/page.tsx        Settings (commish)
src/app/(app)/leagues/[id]/draft/page.tsx           DRAFT ROOM (live)
src/app/(app)/leagues/[id]/team/[teamId]/page.tsx   Team/roster + weekly lineup
src/app/(app)/leagues/[id]/matchup/[mid]/page.tsx   Matchup detail (live, Live Mode style)
src/app/(app)/leagues/[id]/standings/page.tsx       Standings + playoff bracket
src/app/(app)/leagues/[id]/players/page.tsx         League players / free agents / waivers
src/app/(app)/leagues/[id]/trades/page.tsx          Trade center
src/app/(app)/leagues/[id]/activity/page.tsx        Activity + Commissioner Action Log
src/app/(app)/leagues/[id]/commish/page.tsx         Commissioner Console (commish only)
src/app/u/[username]/leagues/[slug]/page.tsx        Public league page (SEO, read-only summary)
```

### 16.2 Key components
```
src/components/leagues/league-create-wizard.tsx     stepper: format → roster → scoring → waivers/trades → draft → invite
src/components/leagues/settings-panel.tsx           grouped, validated settings forms
src/components/leagues/scoring-editor.tsx           full custom scoring (presets + per-category)
src/components/leagues/roster-slot-builder.tsx      per-position starter counts + "Add Custom Flex" (eligible-position multi-select) + bench count + IR spots (each set Restricted/Unrestricted with eligible designations + min weeks); live roster_size + validation
src/components/leagues/invite-panel.tsx             code/link + username/email invites + seat list
src/components/leagues/attach-list-modal.tsx        attach a ranking list to a league; set primary board / share
-- Draft room --
src/components/draft/draft-room.tsx                 layout shell; subscribes to draft channel; reconnect-safe
src/components/draft/draft-board-grid.tsx           rounds × teams pick grid
src/components/draft/pick-clock.tsx                 server-deadline countdown + paused state
src/components/draft/available-players.tsx          searchable/filterable pool w/ Big Board/ADP/tier + league-list overlays, and an "only players on my list" filter
src/components/draft/my-queue.tsx                    drag-to-reorder queue
src/components/draft/my-lists-panel.tsx              league-tagged lists: cheat sheet, pool overlay, load-into-queue, primary board
src/components/draft/my-roster-tracker.tsx          slots filling up + needs
src/components/draft/auction-block.tsx              current nomination, bid input, budgets, max-bid, anti-snipe
src/components/draft/draft-chat.tsx                  realtime chat + system (commish) posts
src/components/draft/commish-draft-panel.tsx        pause/undo/reassign/move/force/reset (commish)
src/components/draft/presence-bar.tsx               who's online / on the clock (Presence)
-- In-season --
src/components/leagues/lineup-editor.tsx            slot-based starters/bench, lock-aware (reuse from spec-leagues-live-mode)
src/components/leagues/swap-assignment.tsx          assign one Swap: protect a starter ↔ same-position bench player; armed/triggered state; rendered below Flex, above K/D-ST/IR
src/components/leagues/matchup-view.tsx             head-to-head live scoreboard (Live Mode patterns)
src/components/leagues/standings-table.tsx          tiebreaker-ordered, division-aware
src/components/leagues/playoff-bracket.tsx          seeds, byes, reseed
src/components/leagues/free-agents-table.tsx        add/claim, FAAB bid modal
src/components/leagues/trade-builder.tsx            two-sided selector w/ legality preview
src/components/leagues/activity-feed.tsx            unified feed w/ commissioner action treatment
-- Commissioner --
src/components/leagues/commish-console.tsx          tabbed hub for all overrides (§10.1)
src/components/leagues/commish-action-modal.tsx     shared reason-required + before/after confirm wrapper
src/components/leagues/illegal-lineup-flow.tsx      guided remedy (§10.2)
src/components/leagues/audit-log.tsx                filterable, human-readable, diff viewer; "✸ commissioner" badges
```

### 16.3 UX principles for the draft room
- **One-glance clarity:** who's on the clock, time left, my next pick, my needs — always visible.
- **Latency-resilient:** optimistic *intent* (button press) but authoritative *result* (broadcast); show "submitting…" states; resolve races with a friendly "that player just went off the board."
- **Reconnect = refetch then resubscribe.** Never depend on missed broadcasts.
- **Commish panel is unmistakable** (distinct accent) and every commish action shows the live system post in chat so the room sees it happen.
- **Accessible** to WCAG 2.1 AA (focus states, live-region announcements for picks/clock, color-independent status). Run the `design:accessibility-review` skill before handoff.

---

## 17. Permissions & Access Control Matrix

| Action | Guest | Manager | Co-Commish | Commish |
|---|---|---|---|---|
| View public league summary | ✓ | ✓ | ✓ | ✓ |
| View full league (rosters, chat, activity) | — | ✓ (member) | ✓ | ✓ |
| Create league | — | — (needs Pro) | — | ✓ (Pro) |
| Join via invite | sign-up first | ✓ | ✓ | ✓ |
| Edit league settings | — | — | ✓ | ✓ |
| Draft: pick/bid/queue for *own* team | — | ✓ | ✓ | ✓ |
| Draft: pause/undo/reassign/move/reset | — | — | ✓ | ✓ |
| Set *own* lineup / add-drop / waivers / trades | — | ✓ | ✓ | ✓ |
| Override score / set result / move player / reverse trade / edit FAAB / edit standings | — | — | ✓ | ✓ |
| Report an illegal lineup | — | ✓ (report) | ✓ (resolve) | ✓ (resolve) |
| Read commissioner audit log | — | ✓ | ✓ | ✓ |
| Append to / edit / delete audit log | — | — | append-only | append-only |

Enforced at three layers: **RLS** (DB), **Route Handler** auth checks (Zod + role), and **UI** affordance gating. RLS is the backstop — never trust the client.

---

## 18. Phased Build Plan (this feature)

Each phase ships something demoable and testable. Hand Claude Code **one phase at a time** (per `docs/04-BUILD-ROADMAP.md` guidance). Build prompts in **Appendix C**.

### Phase A — League foundation & settings
- Migrations: ALTER `leagues`, add `league_members`, RLS helpers (§12.0–12.2).
- Create-league wizard, settings panel, scoring editor, roster-slot builder, invites/join, roles, placeholder seats, lifecycle status. Attach existing ranking lists to a league (`league_lists`, §7.4/§12.15).
- **Gate:** a commissioner can create an 8/10/12/14/16/18/20-team league, fully configure it (defaults valid), invite & seat managers, and reach `scheduled`.

### Phase B — Snake draft engine
- Migrations: `drafts`, `draft_picks`, `draft_queues` + RPCs (`draft_start`, `draft_make_pick`, `draft_undo`, `draft_tick`) + `draft-tick` worker.
- Draft room (board, clock, pool, queue, roster tracker, chat, presence), autopick, disconnect grace, commissioner panel (pause/undo/reassign/move/force/reset). **My Lists** panel — view league-tagged lists, overlay on the pool, load into the queue — with primary-board autopick (§8.9).
- **Gate:** run a full snake draft to completion with live clients; commissioner can pause, undo (single + cascade), reassign a pick, and move a drafted player between teams; disconnect/reconnect is seamless; `league_rosters` populated; status → `in_season`.

### Phase C — Auction draft engine
- Migrations: `draft_bids` + RPCs (`draft_nominate`, `draft_place_bid`, auction `draft_tick` path).
- Auction block UI: budgets, max-bid, nomination/bid clocks, anti-snipe; commissioner budget/undo controls.
- **Gate:** run a full auction with budgets enforced (no overspend, every team completes a legal roster), anti-snipe works, commissioner can reverse a won bid and adjust budgets.

### Phase D — In-season play
- Migrations: `league_rosters`, `matchups`, `transactions`, `waiver_claims`, `trades`/`trade_items`; extend `team_lineups`.
- Schedule generation, lineup editor + lock, live matchup scoring (reuse Live Mode), standings + tiebreakers, waivers/FAAB job, free agency, trade center + review/veto, activity feed, playoffs/bracket. **Swap spot** auto-substitution (assign + arm at lock; `process-swaps` fires pre-game/in-game).
- **Gate:** a league plays a simulated week end-to-end: set lineups → lock → live scores → finalize → standings update; waivers process; a trade completes under review; playoffs generate.

### Phase E — Commissioner Console + Audit Log (the differentiator)
- Migration: `commissioner_actions` (+ FKs on matchups/transactions) and the `logCommissionerAction()` helper wired into every override RPC.
- Commissioner Console (all powers §10.1), reason-required modal, before/after diffs, illegal-lineup guided flow, member-visible audit log with "✸ commissioner" badges + auto chat posts.
- **Gate:** every override path writes an immutable, member-visible log entry with a required reason and correct before/after; changing a matchup result from the illegal-lineup flow works and is visible to all members; no override can occur without a log entry; audit entries cannot be edited/deleted by anyone.

### Phase F — Polish & extras
- Mock drafts, draft order reveal animation, notifications wiring, History Mode tab, hash-chain tamper-evidence on the audit log, performance pass on the draft room (up-to-20-team concurrency), full accessibility pass, public league SEO page, optional auto-sub inactives.
- **Gate:** load/concurrency test a 20-team live draft; Lighthouse/CWV acceptable; `design:accessibility-review` passes.

> **Stack note for Claude Code:** the repo `CLAUDE.md` lists React Query + Zustand for state and `@supabase/ssr` clients. Use Zustand for ephemeral draft-room UI state (timer display, selected player, panel open) and React Query + Realtime subscriptions for authoritative data. All draft/transaction writes go through Route Handlers calling the RPCs — never write these tables from the client.

---

## 19. Acceptance Criteria & Test Cases

### 19.1 Functional acceptance (must all pass)
- Create leagues of every supported size (**8, 10, 12, 14, 16, 18, 20**); defaults produce a valid, draftable configuration with no manual fixes.
- Commissioner can set per-position starter counts, **add one or more custom flex slots with any eligible-position combination** (WR/TE, WR/RB, RB/TE, WR/RB/TE, superflex, IDP flex, …), and set **bench** and **IR** counts; lineup validation respects each slot's eligibility, including multiple distinct flex slots.
- A user can **attach a ranking list to a league**, set it as their **primary draft board**, and **load it into the queue** from the Live Draft Tool; pool overlays/filters work; **shared** lists appear to all members; the primary board feeds autopick.
- Commissioner can add multiple **IR spots** and set each **Unrestricted** (free in/out for eligible players, before lock) or **Restricted** (eligible designation + minimum stint, default 4 weeks); the system blocks early removal from a Restricted IR spot, with a commissioner override.
- With a **Swap spot** enabled, a manager can arm one same-position bench player to auto-start for a chosen starter; the swap locks at first Sunday kickoff (or Thursday if a Thursday player is involved) and fires automatically on a pre-game inactive or an in-game injury.
- Snake and auction drafts each complete with all rosters legal and full.
- Pick/nomination/bid clocks count from a server deadline; timeouts autopick/close correctly even with **all clients disconnected**.
- Commissioner can pause/resume, undo (single + cascade), reassign a pick, **move a drafted player to another team**, force a pick, reset the draft.
- In-season: lineups set & lock correctly; live scores match the league scoring system; matchups finalize; standings order by the configured tiebreakers; waivers/FAAB resolve; trades complete under each review mode; playoffs/bracket generate with byes/reseed.
- **Commissioner can change a head-to-head result** (incl. via the illegal-lineup flow); the change is visible to every member with the reason and a before/after diff.
- Every override writes exactly one immutable `commissioner_actions` row; the row is readable by all members and cannot be edited or deleted by anyone (including the commissioner).
- League creation is Pro-gated; joining is free.

### 19.2 Critical edge cases / test matrix
| # | Scenario | Expected |
|---|---|---|
| E1 | Two managers pick the same player within milliseconds | Exactly one succeeds; loser sees "just went off the board"; no duplicate in `league_rosters`/`draft_picks` (unique index holds). |
| E2 | Manager double-taps "Draft" / retries on flaky network | Idempotent via `action_id`; one pick recorded. |
| E3 | On-the-clock manager disconnects | After `disconnect_grace_seconds`, autopick from queue→BigBoard→ADP filling a need; reconnect restores manual control. |
| E4 | Commissioner undoes pick #40 in a 120-pick draft (cascade) | Picks 40+ reverted, players returned to pool, clock rewound to pick 40, all clients converge; an audit entry is written. |
| E5 | Auction: team tries to bid beyond max-bid (would orphan a slot) | Rejected; max-bid formula guarantees a fillable roster. |
| E6 | Auction anti-snipe: bid placed with 3s left (threshold 10s) | Clock resets to 10s; last bid at 0 wins. |
| E7 | FAAB: two equal top bids on one player | Tiebreaker (`reverse_standings`/`rolling_priority`) deterministically resolves; balances/priority update; losers marked. |
| E8 | Player exclusivity under trade + waiver racing for same player | Atomic; player ends on exactly one roster; the other action fails cleanly. |
| E9 | Illegal lineup (started a bye player) | Commissioner flag → choose remedy (zero-out / set result / sub) → applied, logged with reason, system chat post, badge on matchup, managers notified. |
| E10 | NFL stat correction lands within window on a non-final matchup | Auto-recompute; if the cell was commissioner-overridden, the override is preserved (no double-credit). |
| E11 | Commissioner reverses a completed trade | Both rosters restored atomically; exclusivity preserved; audited. |
| E12 | Attempt to UPDATE/DELETE a `commissioner_actions` row (even as commish, even via SQL with anon/auth role) | Denied by RLS (no such policy exists). |
| E13 | Non-member hits any league API/Realtime channel | Denied by RLS; no data leaks (incl. blind waiver bids hidden pre-process). |
| E14 | 20-team live draft, all online, fast clock | No dropped picks, clock drift < 1s across clients, board stays consistent. |
| E15 | Mid-draft setting change (e.g., clock length) | Applies to subsequent picks only; current deadline handled gracefully; audited if post-start. |
| E16 | Lineup with overlapping flex slots (e.g., W/R/T + W/T + SUPERFLEX) | Bipartite slot-fit validates correctly; each player fills exactly one slot; a legal lineup is accepted and an illegal one names the unfillable slot. |
| E17 | A player on the user's overlay list / queue is drafted by someone else | Overlay, queue, and "best available from my list" update live via the draft channel; the player is greyed/removed; primary-board autopick skips him. |
| E18 | Manager tries to remove a player from a **Restricted** IR spot before the min stint (e.g., week 2 of a 4-week stint) | Blocked with a clear message ("eligible to activate in Week N"); **Unrestricted** IR allows the move; commissioner override works and is logged. |
| E19 | A Restricted-IR player heals (loses eligible designation) mid-stint | Roster flagged illegal until resolved, but the player still can't be activated before the stint ends; commissioner override available. |
| E20 | Protected starter is inactive at kickoff (armed swap) | Swap-in player auto-starts in the exact slot and scores; activity feed + matchup reflect it live. |
| E21 | Protected starter exits injured mid-game (armed swap) | Swap fires; the slot is credited the greater of the starter's accrued points or the swap-in's full points (default rule, §21). |
| E22 | Swap-in is a different position than the protected starter (e.g., WR for an RB-in-FLEX) | Rejected at assignment — exact `player.position` match required. |
| E23 | A Thursday player is the *out* or *in* player | Swap locks at Thursday kickoff (not Sunday); can't be set/edited after the Thursday game starts. |
| E24 | Swap-in is also inactive when the swap would fire | No benefit; slot resolves to the greater (often 0); manager is not further penalized. |

### 19.3 Verification approach (for the build)
- **Unit:** scoring math, tiebreaker ordering, snake-order generation (incl. 3rd-round reversal), auction max-bid, FAAB resolution, roster legality/eligibility.
- **Integration (DB):** RLS policies per role (member/non-member/commish), exclusivity unique index, audit immutability, RPC validators.
- **E2E (Playwright):** full snake draft, full auction, disconnect/reconnect, commissioner overrides, a simulated scored week, waiver run, trade under review. Use `npm run test` / `npm run test:e2e` (already in `CLAUDE.md`).
- **Load:** simulate 14 concurrent drafters on a fast clock (E14).
- Run `design:accessibility-review` and a `security-review` of the RLS/RPC surface before launch.

---

## 20. Success Metrics (feature-specific)
| Metric | Target (first season post-launch) |
|---|---|
| Leagues created | 1,000 |
| Drafts completed | 800 (≥80% of created leagues draft) |
| Draft completion rate (started → finished without abandonment) | ≥ 95% |
| Median draft-room action latency (pick→broadcast) | < 500 ms |
| Weekly active managers during season | 6,000 |
| Leagues using ≥1 commissioner override | ≥ 40% (validates the differentiator is used) |
| Manager-reported trust in commissioner fairness (survey) | ≥ 4.3/5 |
| Pro conversions attributable to league creation | track as a primary Pro driver |
| Season completion rate (leagues that finish) | ≥ 70% |

---

## 21. Open Questions / Decisions Needed
Each has a **recommended default** so the build is not blocked.

1. **Roadmap placement** — expanded Phase 8 vs. dedicated track? *Rec: dedicated "Leagues" epic after Phase 4 (Pro) + the Live Mode pipeline land, since it's the biggest retention bet.*
2. **Real money / dues** — keep out of v1? *Rec: yes, out of v1; design `transactions`/`league_members` to not preclude a future wallet.*
3. **Keeper/dynasty** — needed soon? *Rec: redraft-only v1; `format` enum reserved.*
4. **Slow/multi-day drafts** as a supported product (not just possible)? *Rec: support long timers technically; market live drafts in v1.*
5. **IDP** in default QA scope? *Rec: schema-supported, off by default, not a v1 QA focus.*
6. **History Mode monetization** ($5/yr from existing PRD) — keep, fold into Pro, or free? *Rec: include data free in v1; revisit paywall later.*
7. **Co-commissioner** in v1? *Rec: yes (cheap, high value, same audit trail).*
8. **Mobile draft room depth** — full parity at launch? *Rec: full parity; it's where draft night happens.*
9. **Naming** — surface as "Leagues" (replacing the simulation concept) or a new label like "Play"/"Compete"? *Rec: keep "Leagues"; the simulation becomes a non-default mode.*
10. **Auto-bid for absent managers in auctions** (incumbents do this) — v1 or later? *Rec: later; v1 simply doesn't bid for the absent.*
11. **In-game Swap scoring resolution** — greater-of (default) vs. strict swap-replaces-from-injury? *Rec: greater-of — a clear safety net, not exploitable.*

---

## Appendix A — Competitor Comparison

Synthesized from official help docs (ESPN, Yahoo, Sleeper) cross-checked with NFL.com, MyFantasyLeague (MFL), Fleaflicker. Values reflect the 2024–25 products. ⚠ = vendor docs don't state it / conflicting; treated as secondary.

### A.0 Reality check on the named platforms
- **Flock Fantasy** — **not a league host.** It's an analytics/rankings/creator-content companion that *syncs to* your ESPN/Yahoo/Sleeper league (rankings, a read-only league dashboard, trade calculator, practice mock drafts, and a draft-overlay Chrome extension, best-ball leaning). There is no Flock draft engine or league/scoring/commissioner settings to mirror. Useful as content/UX inspiration only.
- **Footballguys** — **not a league host.** It's a research/projections/draft-*assistant* business (Draft Dominator runs alongside a draft hosted elsewhere; "Footballguys Home Leagues" are actually hosted on Sleeper). Great benchmark for draft-prep UX and customizable projections, not for hosting mechanics.
- **Benchmarks that matter:** **Sleeper** (best-in-class draft + the best commissioner transparency), with **ESPN/Yahoo** as the mass-market baseline and **MFL/Fleaflicker** as the deep-customization references.

### A.1 League settings
| | ESPN | Yahoo | Sleeper |
|---|---|---|---|
| Team count | 4–20 (def 10) | 4–20 (def 10) | ~4–32 ⚠ |
| Native dynasty type | No (keeper) | No (keeper/renewed) | Yes (startup/supplemental) |
| Divisions | 1–4 (def 2) | yes ⚠ max | yes |
| Playoff teams | 2–16 (def top 4 public) | 4/6/7/8 | configurable |
| Reseed | manual only | toggle | configurable |
| Waiver types | Standard, FAB, FAB-continuous, none | Weekly/continuous; rolling/reverse/weekly/FAB | rolling/reverse/FAAB/custom-daily/FCFS |
| FAAB default | $100 ⚠ | **$100** ($1–$999) | **$100** |
| Trade review | none/vote/commish | vote(def, ⅓)/commish/none | veto/force/reverse (commish strong) |
| Lineup lock | per-player kickoff (def) / first-game | per-player (def) / weekly | per-player (def); commish edits completed weeks only |

### A.2 Scoring defaults (per-reception & key values)
| | ESPN | Yahoo | Sleeper |
|---|---|---|---|
| Default reception | half/fractional (public) | **0.5 (half-PPR)** | 0.5 (half) |
| Passing TD | 4 | 4 | 4 |
| INT thrown | **−2** | **−1** | −1/−2 (config) |
| Fractional/decimal | yes | **yes (on)** | yes |
| D/ST points-allowed model | **split +5 pts / +5 yds (start +10)** | **single +10 tier table** | tiered |
| TE premium / bonuses | supported | supported (bonuses off by default) | supported |

→ FieldScout supports **both** D/ST models and TE-premium as first-class (Appendix B).

### A.3 Draft — timers & types
| | ESPN | Yahoo | Sleeper |
|---|---|---|---|
| Snake | ✓ (def) | ✓ (def) | ✓ (def) |
| Linear / 3rd-round reversal | manual / — | non-snaking toggle | **one-click 3RR** |
| Auction ("salary cap") | ✓ | ✓ | ✓ |
| Snake pick timer | 30/60/90/120s (def 30) | def 60s; list ⚠ | **10s → 24h** |
| Slow/multi-hour drafts | up to 24h (2025) | none | **up to 24h** |
| Pause | yes (admin needs pause) | 20×, 60 min total | unlimited |
| Undo picks | **cascading** (undoes all later) | **per-pick granular** | any pick, any round |
| Pick for a manager | snake only | ⚠ | yes (+force CPU) |
| Disconnect handling | explicit grace setting | clock→autopick | clock→autopick; commish pause |

→ FieldScout: configurable timers (0s–24h), **both** single-pick and cascade undo, drag-to-move any drafted player, ESPN-style disconnect grace.

### A.4 Auction defaults
| | ESPN | Yahoo | Sleeper |
|---|---|---|---|
| Budget default | $200 | $200 ⚠ (max $999) | **$100** |
| Nominate / bid timer | 30s / 30s | 30s / 20s | configurable |
| Anti-snipe | ⚠ | **bid <10s → reset to 10s** | **reset to 10s** |
| Min bid | $1 | $1 | $1 |

→ FieldScout default budget **$200**, nominate 30s / bid 20s, anti-snipe 10s (configurable).

### A.5 Commissioner powers & transparency (the differentiator)
| Capability | ESPN | Yahoo | Sleeper | MFL | Fleaflicker | **FieldScout (this spec)** |
|---|---|---|---|---|---|---|
| Edit score / set H2H result | delta-adjust (web, H2H only) | Edit Team Points | edit + recalc | Score Adjuster | **Edit Past Box Score** | **Set score OR set result directly** |
| Move player between teams | manual roster edit | manual | post-week edit | act as franchise | Edit Rosters | **one-click drag move** |
| Reverse completed trade | manual rebuild | dedicated tool | **yes** | manual rebuild | manual (picks can't) | **one-click reverse** |
| Edit FAAB balance | LM tools | yes | app-only | accounting | yes | **yes** |
| Retroactive lineup edit | yes | yes (retro) | completed weeks | deadline-exempt | live week only | **yes, any week** |
| **Member-visible audit log** | partial (LM Actions + asterisk) | **weak/unclear** | **strong (auto chat, non-disable)** | **deletable records** ⚠ | good (attributes commish vs NFL) | **immutable, append-only, member-visible, reason-required, before/after, hash-chain** |
| Illegal-lineup penalty engine | none (manual) | none | none | partial | "illegal rosters still score" | **guided flow + logged remedy** |

**The wedge in one line:** everyone gives the commissioner power; **no one makes that power transparent and tamper-evident.** FieldScout does.

---

## Appendix B — Default Scoring Presets & `scoring_systems.rules` Catalog

Reuses the existing `scoring_systems.rules JSONB` (see `docs/03-DATA-MODEL.md`). Ship these as `is_system_default = true`. Decimal supported throughout.

### B.1 Core offense (all presets share these; only `receptions` differs)
| Key | Standard | Half-PPR | Full PPR |
|---|---|---|---|
| `pass_yards` | 0.04 | 0.04 | 0.04 |
| `pass_tds` | 4 | 4 | 4 |
| `interceptions` | −2 | −2 | −2 |
| `pass_2pt` | 2 | 2 | 2 |
| `rush_yards` | 0.1 | 0.1 | 0.1 |
| `rush_tds` | 6 | 6 | 6 |
| `rush_2pt` | 2 | 2 | 2 |
| `receptions` | **0** | **0.5** | **1** |
| `receiving_yards` | 0.1 | 0.1 | 0.1 |
| `receiving_tds` | 6 | 6 | 6 |
| `rec_2pt` | 2 | 2 | 2 |
| `fumbles_lost` | −2 | −2 | −2 |
| `fumble_recovery_td` / `return_td` | 6 | 6 | 6 |

### B.2 Optional bonuses & TE premium (off by default)
`pass_300_bonus`, `pass_400_bonus`, `rush_100_bonus`, `rush_200_bonus`, `rec_100_bonus`, `rec_200_bonus`, `te_reception_premium` (added per-reception for TEs, e.g. +0.5), `pass_40yd_td_bonus`, etc.

### B.3 Kicking (by distance)
`fg_0_39` = 3, `fg_40_49` = 4, `fg_50_plus` = 5, `pat_made` = 1, `fg_missed` = −1 (off/0 by default on some presets), `pat_missed` = −1.

### B.4 D/ST — supports BOTH models
- **Play categories:** `def_sack` 1, `def_int` 2, `def_fumble_rec` 2, `def_td` 6, `def_safety` 2, `def_block` 2, `def_return_td` 6.
- **Points-allowed (single-tier, Yahoo-style, default):** `def_pa_0` 10, `def_pa_1_6` 7, `def_pa_7_13` 4, `def_pa_14_20` 1, `def_pa_21_27` 0, `def_pa_28_34` −1, `def_pa_35_plus` −4.
- **Split model (ESPN-style, optional):** enable `def_pa_*` (start +5) **and** `def_ya_*` yards-allowed tiers (start +5) → +10 baseline. A `dst_model` flag in `rules` selects `single` (default) or `split`.

### B.5 IDP (off by default)
`idp_tackle_solo` 1, `idp_tackle_assist` 0.5, `idp_sack` 2, `idp_tfl` 1, `idp_qb_hit` 1, `idp_int` 3, `idp_pass_defended` 1, `idp_forced_fumble` 2, `idp_fumble_rec` 2, `idp_def_td` 6, `idp_safety` 2.

> The custom **scoring-editor** UI groups these into Passing / Rushing / Receiving / Misc / Kicking / D/ST / IDP, mirrors the platform presets as starting points, and shows a "differs from default" summary (reusing the existing "Custom Scoring" badge concept from `docs/01-PRD.md` §F7).

---

## Appendix C — Claude Code Build Prompts

Copy-paste prompts in the style of `docs/05-CLAUDE-CODE-PROMPTS.md`. **Hand Claude Code one task at a time**, in order. Each assumes the repo is open and the prior task is committed.

### Task L.A1 — League foundation: schema + RLS
```
Build the league foundation for FieldScout. Read CLAUDE.md, docs/03-DATA-MODEL.md, and docs/specs/spec-redraft-leagues.md (§12) before starting. This supersedes the thin leagues schema in spec-leagues-live-mode.md.

1. Migration supabase/migrations/0XX_leagues_foundation.sql:
   - RLS helper functions is_league_member(uuid) and is_league_commish(uuid) (SECURITY DEFINER, STABLE) — §12.0
   - ALTER TABLE leagues to add: status, format, team_count CHECK IN (8,10,12,14,16,18,20), regular_season_weeks, playoff_teams, playoff_start_week, waiver_type, faab_budget, trade_review, trade_deadline_week, lineup_lock, settings JSONB, deleted_at — §12.1
   - Replace the old "viewable by members" policy with one using is_league_member()
   - CREATE TABLE league_members (role, team_id, is_placeholder, is_autodraft, faab_balance) + RLS + indexes — §12.2
2. Zod schemas in src/types/league.ts for all settings (§7.3) with the documented defaults and ranges; a validateLeagueSettings() util enforcing the cross-field rules in §7.3 "Validation rules".
3. API route handlers (Route Handlers, kebab-case): POST/GET /api/leagues, GET/PATCH/DELETE /api/leagues/[id], POST /api/leagues/[id]/invite, POST /api/leagues/join, member management under /api/leagues/[id]/members — §15.1. Gate POST /api/leagues behind is_pro.
4. React Query hooks: src/hooks/use-leagues.ts, use-league.ts, use-league-members.ts.
5. Regenerate types: npx supabase gen types typescript.
Enforce: creator becomes commissioner + gets a team; joining is free; team_count ∈ {8,10,12,14,16,18,20}; structural settings editable only in setup/scheduled (else require a commissioner override flag).
```

### Task L.A2 — League create wizard + settings UI
```
Build the league creation wizard and settings UI. Read docs/specs/spec-redraft-leagues.md (§7, §16) and docs/06-DESIGN-SYSTEM.md.

1. src/app/(app)/leagues/page.tsx (My Leagues + Create), /leagues/new/page.tsx (wizard), /leagues/[id]/settings/page.tsx.
2. Components: league-create-wizard.tsx (steps: format → roster slots → scoring → waivers/trades → draft → invite), roster-slot-builder.tsx (per-position starter counts, "Add Custom Flex" via an eligible-position multi-select, bench count, and IR spots each configured Restricted/Unrestricted with eligible designations + min weeks, live roster_size + validation), scoring-editor.tsx (presets + full custom per Appendix B; "differs from default" summary), settings-panel.tsx, invite-panel.tsx (code/link + username/email + seat list, placeholder seats, roles).
3. Use the Zod schemas + defaults from Task L.A1. Mobile-first, dark, shadcn/ui. All ranges/defaults per §7.3.
Acceptance: create an 8/10/12/14/16/18/20-team league with valid defaults in <2 min, invite & seat managers, reach status 'scheduled'.
```

### Task L.B1 — Snake draft: engine, RPCs, timer worker
```
Build the server-authoritative snake draft engine. Read docs/specs/spec-redraft-leagues.md (§8, §9, §12.3–12.6, §14) before starting. The engine MUST be server-authoritative — clients never decide turns, time, or legality.

1. Migration: drafts, draft_picks (with UNIQUE partial index uniq_draft_player_live), draft_queues + RLS (§12.3–12.6). Store league_id on child rows for simple RLS.
2. Postgres RPCs (SECURITY DEFINER), each: SELECT drafts FOR UPDATE → validate → write → advance → set current_deadline:
   - draft_create(league_id), draft_start(draft_id), draft_make_pick(draft_id, action_id, team_id, player_id), draft_set_queue(...), draft_toggle_autodraft(...)
   - Commissioner: draft_pause, draft_resume, draft_undo(draft_id, to_pick_number), draft_force_pick(...), draft_reassign_pick(...), draft_move_player(...), draft_reset(...)
   - Autopick helper: best available from queue → user's season Big Board → players.adp, filtered to fill an open roster need.
   - Idempotency via action_id; exclusivity via the unique index; friendly error on race.
3. Edge Function supabase/functions/draft-tick + pg_cron (every ~5s while a draft is 'live'): enforce current_deadline → autopick; no-op when none live. Self-schedule after each action for tight timing.
4. Route Handlers under /api/leagues/[id]/draft/* (§15.2) calling the RPCs. Commissioner routes also insert commissioner_actions (added in Task L.E1; stub the call until then).
5. Add drafts/draft_picks to supabase_realtime publication.
Acceptance: a full snake draft runs to completion across multiple browser tabs; timeouts autopick even with all tabs closed; no duplicate players under concurrent picks.
```

### Task L.B2 — Draft room UI (snake)
```
Build the live draft room UI. Read docs/specs/spec-redraft-leagues.md (§8.5, §9, §16.2–16.3) and docs/06-DESIGN-SYSTEM.md.

1. src/app/(app)/leagues/[id]/draft/page.tsx + components/draft/*: draft-room.tsx (subscribes to draft:<id>; on mount/reconnect FETCH state via REST then subscribe), draft-board-grid.tsx, pick-clock.tsx (countdown from server current_deadline + measured offset; paused state), available-players.tsx (search/filter, Big Board/ADP/tier overlays), my-queue.tsx (@dnd-kit drag), my-roster-tracker.tsx, draft-chat.tsx, presence-bar.tsx (Supabase Presence).
2. Use Zustand for ephemeral UI (selected player, panel state, local clock); React Query + Realtime for authoritative data. Optimistic INTENT only; authoritative RESULT from broadcast. Friendly "player just went off the board" on race.
3. Touch-friendly; WCAG AA (live-region announcements for picks/clock).
Acceptance: draft night feels instant; reconnect restores full state in <2s.
```

### Task L.B3 — Commissioner draft controls
```
Add the in-draft commissioner panel. Read docs/specs/spec-redraft-leagues.md (§8.7, §10.4).

components/draft/commish-draft-panel.tsx wired to the commissioner RPCs from Task L.B1: pause/resume, edit pick clock, undo last, undo-to-pick (cascade, with a confirm showing what will be undone), reassign/edit a pick, DRAG a drafted player from one team to another, pick-for-manager, toggle autopick for any team, reverse a won bid (auction—stub until Task L.C1), reassign a draft seat, reset draft (hard confirm). Distinct accent; every action posts a non-disable-able system message to draft chat. Co-commissioners have identical access. (Audit insert lands in Task L.E1.)
Acceptance: commissioner can fix any mid-draft problem live; the room sees each action happen.
```

### Task L.B4 — Attach lists to leagues + draft-room access
```
Tie ranking lists to leagues and surface them in the draft room. Read docs/specs/spec-redraft-leagues.md (§7.4, §8.9, §12.15) before starting.

1. Migration: league_lists (UNIQUE(league_id,list_id,owner_id); partial unique index = one primary board per member per league) + RLS (own or league-shared readable; owner manages). Add league_lists to the supabase_realtime publication. Add the optional lists SELECT policy so a shared *private* list is readable by league members.
2. API + hooks: POST/GET/PATCH/DELETE /api/leagues/[id]/lists; POST /api/leagues/[id]/draft/queue/from-list/[listId]; src/hooks/use-league-lists.ts.
3. UI — attach: components/leagues/attach-list-modal.tsx (attach a list, set primary board, toggle share); entry points from list detail/card/Big Board and the league page; smart "Attach to {league}" suggestion on scoring/format match; an attach step in the create-league wizard.
4. UI — draft room: components/draft/my-lists-panel.tsx (tab beside My Queue) — attached + league-shared + season Big Board; open as cheat sheet; toggle overlay on available-players (rank/tier column + "only players on my list" filter); one-tap "Load into queue" / "Add remaining"; "best available from my primary board" highlight.
5. Autopick: update strategy to queue → primary league-tagged board → season Big Board → ADP (§8.4).
Acceptance: attach a list, set it primary, load it into the queue, overlay it on the pool, and confirm autopick uses the primary board; a shared list shows to all members; overlays/queue update live as players are drafted (E17).
```

### Task L.C1 — Auction draft
```
Add the auction draft mode. Read docs/specs/spec-redraft-leagues.md (§8.6, §12.5).

1. Migration: draft_bids (store league_id) + RLS + index.
2. RPCs: draft_nominate(draft_id, action_id, team_id, player_id, opening_bid), draft_place_bid(draft_id, action_id, team_id, amount) with budget + max-bid validation (budget − (open_slots−1)×min_bid) and anti-snipe (reset bid clock to auction_anti_snipe_seconds); extend draft-tick to close bids / advance nomination on timeout. Commissioner: reverse a won bid, edit a team's remaining budget (audited).
3. UI: components/draft/auction-block.tsx (current nomination, bid input, per-team budgets + max-bid, nomination & bid clocks, anti-snipe indicator).
Acceptance: full auction with no overspend; every team completes a legal roster; anti-snipe works; commissioner can reverse a won bid.
```

### Task L.D1 — In-season core: rosters, lineups, scoring, standings
```
Build in-season play. Read docs/specs/spec-redraft-leagues.md (§11, §12.7–12.8, §12.13, §14) and reuse Live Mode (spec-leagues-live-mode.md) + src/utils/calculate-fantasy-points.ts.

1. Migration: league_rosters (UNIQUE(league_id,player_id) for exclusivity; ir_placed_week, ir_lock_until_week), matchups, lineup_swaps (§12.16); ALTER team_lineups (slot_map, locked_at, edited_by_commish). Populate league_rosters from draft_picks on draft completion (status → in_season). Enforce IR slot rules (§7.3.2): placement requires an eligible designation; Restricted IR blocks removal until ir_lock_until_week (commissioner override allowed).
2. Schedule generation: round-robin across regular_season_weeks honoring divisions → matchups rows. Tiebreaker-ordered standings util (§7.3.7).
3. Lineup editor (slot-based, lock-aware per lineup_lock), lineup-lock cron, matchup live scoring (Live Mode patterns), finalize-matchups cron (respect overrides; no double-credit on stat corrections), standings + playoff bracket (byes/reseed). Swap spot auto-sub: assign one same-position bench player, arm at lock (first Sunday / Thursday if a Thursday player is involved), and a process-swaps worker that fires pre-game and in-game swaps (§7.3.2/§12.16/§14).
4. Routes/hooks per §15.3. Add tables to realtime publication.
Acceptance: simulate a week end-to-end (set → lock → live → finalize → standings); playoffs generate.
```

### Task L.D2 — Waivers/FAAB, free agency
```
Build waivers, FAAB, and free agency. Read docs/specs/spec-redraft-leagues.md (§13.1–13.2, §12.10).

1. Migration: waiver_claims (blind; own/commish RLS). FAAB balance on league_members.
2. RPC roster_add_drop (exclusivity, legality, caps, lock). Edge Function process-waivers (per-league cadence): resolve FAAB (high bid; tiebreaker; cascading per-team groups) or priority modes atomically → transactions + league_rosters; decrement faab_balance.
3. UI: free-agents-table.tsx (+ FAAB bid modal), pending claims view.
Acceptance: blind bids hidden pre-process; ties resolve deterministically; balances update; exclusivity holds.
```

### Task L.D3 — Trades
```
Build the trade system. Read docs/specs/spec-redraft-leagues.md (§13.3, §12.9, §12.11).

1. Migration: trades, trade_items, transactions (if not already). 
2. RPCs: trade_propose, trade_respond (accept/reject/cancel/vote), trade_execute (atomic roster swap, exclusivity, FAAB transfer if allowed) honoring trade_review (none/commissioner/league_vote) + trade_review_period_hours; trade-review-expiry cron; trade_deadline_week enforcement.
3. UI: trade-builder.tsx (two-sided, legality preview), trade center page, vote UI.
Acceptance: a trade completes under each review mode; deadline enforced.
```

### Task L.E1 — Commissioner Console + Audit Log (the differentiator)
```
Build the commissioner override system and the immutable, member-visible audit log. Read docs/specs/spec-redraft-leagues.md (§10, §12.12) carefully — this is the product's key differentiator.

1. Migration: commissioner_actions (reason CHECK length>0; SELECT for all members; INSERT only by commissioners; NO update/delete policies = immutable). Add matchups.override_action_id and transactions.related_action_id FKs.
2. A logCommissionerAction() helper that every override RPC calls IN THE SAME TRANSACTION as the state change, so no state change can occur without a log entry. Refactor the commissioner RPCs from L.B3/L.C1/L.D* to call it.
3. Override RPCs + routes (§15.4), each requiring a reason and writing before/after: commish_edit_score, commish_set_result, commish_move_player, commish_force_add_drop, commish_edit_lineup (any week), commish_force_or_reverse_trade, commish_edit_faab, commish_edit_record, commish_edit_schedule, commish_change_setting (optional rescore), reassign team, promote/demote.
4. UI: commish-console.tsx (tabbed hub §10.1), commish-action-modal.tsx (reason-required + before/after confirm wrapper used everywhere), illegal-lineup-flow.tsx (§10.2: flag → remedy → apply+log+announce), audit-log.tsx (filterable, human-readable, diff viewer, "✸ commissioner" badges; auto system chat posts that cannot be disabled).
5. Wire the "✸ adjusted by commissioner" badge onto any overridden matchup/score/roster, linking to the log entry.
Acceptance (all must pass): every override writes exactly one immutable log row readable by all members; changing a head-to-head result via the illegal-lineup flow works and is visible with reason + diff; attempting to UPDATE/DELETE a log row is denied for everyone; a state change can never be written without its log entry.
```

### Task L.F1 — Polish & hardening
```
Polish the leagues feature. Read docs/specs/spec-redraft-leagues.md (§18 Phase F, §19).

Mock drafts (drafts.is_mock, no league_rosters written), draft-order reveal animation, notifications wiring (league_invite, trade_proposal, commissioner action, waiver result), History Mode tab, optional hash-chain tamper-evidence on commissioner_actions (prev_hash/row_hash), auto-sub inactives (opt-in), public league SEO page. Then: Playwright E2E for full snake draft, full auction, disconnect/reconnect, commissioner overrides, a scored week, waiver run, and a trade; a 14-team concurrency load test of the draft room; run the design:accessibility-review and a security-review of the RLS/RPC surface. Fix what they find.
```

---

## Changelog
- **v1.6 (2026-06-24):** Locked the **Swap spot** to a single on/off setting (`swap_spots` = 0/1 — one swap per team; dropped the 0–3 range to avoid confusing mid-week lineup changes) and enforced it with `lineup_swaps` `UNIQUE(team_id, season, week)`. Added a UI rule: render the Swap spot **below Flex/superflex and above K, D/ST, IR**. Resolved the "multiple swaps" open question.
- **v1.5 (2026-06-24):** Added the optional **Swap spot** (§7.3.2) — a team arms **one** same-position bench player to auto-start if a chosen starter is ruled out **pre-game or in-game**; exact `player.position` match required even for FLEX starters; locks at first Sunday kickoff (or Thursday if a Thursday player is involved). New `roster_settings.swap_spots` count, `lineup_swaps` table (§12.16), `process-swaps` worker (§14), enforcement/scoring/validation, UI (`swap-assignment.tsx`), API/hook, acceptance, edge cases E20–E24, and Open Questions 11–12 (in-game resolution + multiple swaps).
- **v1.4 (2026-06-24):** IR spots are now **per-spot configurable** (§7.3.2): each spot is **Unrestricted** (free in/out for eligible players before lock) or **Restricted** (eligible designation + a minimum stint, default 4 weeks, baseball-IL style), with a commissioner-set list of eligible designations. New `roster_settings.ir_slots[]` shape; `league_rosters.ir_placed_week` / `ir_lock_until_week` track tenure; added enforcement (§11.2), validation (§7.3.8), build-prompt notes (L.A2/L.D1), acceptance, and edge cases E18–E19.
- **v1.3 (2026-06-24):** Added the list↔league tie-in — users **attach ranking lists to a league** (§7.4) and use them in the Live Draft Tool (§8.9): cheat sheets, player-pool overlays + "only my list" filter, one-tap load-into-queue, and an optional **primary draft board** that feeds autopick. New `league_lists` table (§12.15) + RLS, API (§15.5), hooks, UI components, build prompt L.B4, glossary entry, and edge case E17.
- **v1.2 (2026-06-24):** Roster section (§7.3.2) generalized so the commissioner sets per-position starter counts, **bench**, and **IR**, and builds **any flex** as a custom eligible-position set (WR/TE, WR/RB, WR/RB/TE, superflex, IDP flex, or any combination). New `roster_settings.starting_slots[]` JSONB shape; lineup legality uses bipartite slot-fitting; added validation, acceptance, and edge case E16. Concurrency target raised to 20-team.
- **v1.1 (2026-06-24):** `team_count` extended to even **8–20** (was 8/10/12/14); `playoff_teams` options extended to 12. Updated the settings catalog, validation rules, SQL `CHECK` constraint, acceptance gates, and Appendix C build prompts to match. (Odd counts still out of scope — easy to enable later.)
- **v1.0 (2026-06-24):** Initial spec. Defines redraft leagues (even **8–20** teams), the server-authoritative snake + auction draft engine with full commissioner live controls, in-season play, and the immutable member-visible Commissioner Action Log differentiator. Supersedes the thin `leagues` schema in `spec-leagues-live-mode.md`. Competitor research in Appendix A; scoring catalog in Appendix B; Claude Code build prompts in Appendix C.

> **Note on scope vs. roadmap:** the project is currently in **Phase 0**. This is a large, late-stage epic that depends on Phases 0–4 + the Live Mode pipeline (§5). Build it after those foundations exist; the phased plan (§18) and prompts (Appendix C) are sequenced to be picked up at that point.












