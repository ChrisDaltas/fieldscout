# PRD / Spec: Redraft Leagues + Custom Draft Engine

**Feature:** Real, playable weekly redraft fantasy football leagues with a fully configurable draft room and an all-powerful, fully-audited commissioner.
**Version:** 2.12.4 (Draft)
**Author:** Chris Daltas
**Date:** July 16, 2026
**Status:** Draft — ready for Claude Code build planning · v2.0 adds scale engineering, the schedule engine + Remix, the stats/NFL-data contract, game-day transaction locks, and operations. Companion doc: `docs/specs/delivery-plan-redraft-leagues.md` (implementation / QA / agent operating model). v2.1 adds the identity contract, seat-targeted invites, and the franchise/manager lifecycle (§7.2.1). v2.2 replaces open custom scoring with an 8-template v1 catalog and introduces **advanced-stat scoring** (air yards, YAC, yards after contact) via the FieldScout Alpha/Ultra templates (§7.3.3, §23.5, Appendix B). v2.3 promotes **Mock Draft Mode** to a core feature (§8.8) and pins the **scoring extensibility contract** — new stats become scorable without engine changes (§7.3.3, §23.5). v2.4 completes the UI inventory: every workflow, page, and control from v2.0–v2.3 is enumerated in §16 (routes/components extended; new §16.5 workflow & states audit). v2.5 adds the **`SyntheticStatsProvider`** (§23.6) so the entire pipeline — draft through live scoring through Alpha/Ultra — is buildable and demonstrably working before any stats vendor is paid. v2.6 locks v1 league sizes to **8–16** (18/20 and odd counts follow next season), makes email the primary invite channel for people without an account yet, sets the v1 playoff tiebreaker chain (Points For → Head-to-head → Points Against), and generalizes commissioner "Act as Manager" to any team, not just orphaned ones. v2.7 re-scopes advanced-stat scoring: the named tracking/charted stats are **illustrative examples**, deferred until a paid/owned real-time stats source is funded; v1 commits to the 6 parity templates plus the §7.3.3 extensibility contract, with the tier machinery proven on placeholder keys.
**Codename:** Hadouken · **Product:** FieldScout (fieldscout.gg)

> This document is written to be handed directly to Claude Code. It follows the conventions in the repo root `CLAUDE.md`, `docs/02-TECHNICAL-ARCHITECTURE.md`, `docs/03-DATA-MODEL.md`, and `docs/06-DESIGN-SYSTEM.md`. SQL, RLS, file paths, and naming match the existing codebase. Where it extends existing tables (`leagues`, `teams`, `team_lineups`, `league_chat`, `scoring_systems`), it says so explicitly and ships a migration.

---

## 1. TL;DR

Today FieldScout treats a "league" as a *simulation* of a user's real home league (see `docs/01-PRD.md` §F9 and `docs/specs/spec-leagues-live-mode.md`). This feature turns FieldScout into a place where friends actually **play**: create a league, invite 8–16 friends, run a real **snake or auction draft** inside a live draft room, then compete head-to-head each week with live scoring, waivers/FAAB, and trades.

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
- **The scoring whitespace (v2.2):** every incumbent — including maximal-customization platforms like Fantrax ("extensive category list") and MFL — scores exclusively from box-score categories. **No platform offers a single tracking- or charting-derived scoring category** (air yards, YAC, yards after contact). Advanced stats are everywhere in *analysis* products and nowhere in *scoring*. That gap is FieldScout's second wedge (§7.3.3): scoring that pays for individual impact, not just box-score residue.

### 2.3 Positioning vs. existing FieldScout features
| Existing | Relationship to this feature |
|---|---|
| `docs/01-PRD.md` §F8 **Teams** | A league roster *is a* team. We reuse `teams` (and its `league_id`) as the per-manager entity inside a league. |
| `docs/01-PRD.md` §F8A **Live Mode** | Live scoring for a league lineup reuses the Live Mode pipeline (`sync-live-stats`, `player_stats`, `nfl_games`). |
| `docs/01-PRD.md` §F9 **Leagues (simulation)** & `spec-leagues-live-mode.md` | **Superseded/expanded.** The simulation concept (placeholder teams, AI recs, History Mode) becomes one mode of a real, playable league. This spec replaces the thin `leagues` schema with a complete one (migration provided). |
| `scoring_systems` | Reused for league scoring via **system-owned templates** (v2.2: 8 fixed templates in v1, `is_template = TRUE`; the `rules` catalog gains advanced-stat keys — Appendix B). User-owned custom systems attach to leagues starting v1.1. |

---

## 3. Goals & Non-Goals

### 3.1 Goals
1. A commissioner can create a redraft league for **4–20** managers (even counts) and configure **every** league, roster, and scoring setting (Appendix B), with sensible defaults so a league can be created in under 2 minutes.
2. A league can run a **real-time snake or auction draft** with configurable order, timers, autopick, queueing, and chat — playable on desktop and mobile.
3. The commissioner has **complete live draft control**: pause/resume, undo (single or cascade), edit/reassign any pick, move a drafted player to another team, force a pick for a manager, and recover gracefully from disconnects.
4. The league plays a full season: weekly H2H matchups, live scoring against the league scoring system, standings/tiebreakers, **waivers + FAAB**, **trades**, free agency, and playoffs.
5. The commissioner can **override anything at any time** — scores, results, rosters, transactions, budgets, schedule — and **every override is captured in an immutable, league-visible audit log** with a required reason and before/after diff.
6. League **creation and joining are both free** (v2.8 ruling, Chris 2026-07-20 — supersedes the earlier Pro gate on creation). Pro-level league features come later; CLAUDE.md Business Rule #5 updated to match.

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
- Phase 2 Teams: `teams`, `team_lineups`, fantasy-points utility (shipped as `src/lib/scoring/default.ts` — the `src/utils/calculate-fantasy-points.ts` path in earlier drafts never existed; league scoring uses the §7.3.3 generic calculator in `src/lib/leagues/scoring/`, erratum v2.7.1).
- Phase 3 Scoring Systems: custom scoring create/apply.
- Phase 4 Pro Subscription: `is_pro` gating.
- Phase 8 Live Mode pipeline: `sync-live-stats`, real-time `player_stats`/`nfl_games`.

**Roadmap recommendation:** treat this as the headline of **Phase 8 (Leagues + Live Mode)**, expanded into its own multi-part epic, or as the "V3 Real Fantasy Platform" milestone pulled forward. It replaces `spec-leagues-live-mode.md`'s thin `leagues` schema. See §18 for the internal phasing (A–F) of just this feature. **Decision for Chris:** confirm whether this lands as expanded-Phase-8 or a dedicated track (Open Questions §21).

---

## 6. Glossary

| Term | Meaning |
|---|---|
| **League** | A hosted, playable competition of 8–16 managers (even counts) for one NFL season in v1 — 18/20 and odd counts are a v1.1 fast-follow. Has one commissioner, settings, a draft, matchups, standings. |
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
| **Swap spot** | An optional roster spot (§7.3.2). A team arms **one** bench player to auto-start in place of a chosen starter if that starter is ruled out **pre-game or at any point during the game** — any official OUT/inactive designation, not injury-specific. The swap player must be the **exact same position** as the protected starter (even if the starter is in a FLEX). Locks at first Sunday kickoff (or Thursday if a Thursday player is involved). |

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

**Identity contract (v2.1 — applies to every league surface).** Every account carries three identity fields, each with exactly one job:

| Field | Example | Job | Visible to |
|---|---|---|---|
| ~~`profiles.display_name`~~ | — | **GONE (v2.9 ruling; DROPPED in v2.9.1).** FieldScout stores no name for a person: an account is an email, a password and a username. *(Migration 075 stopped `handle_new_user` seeding it from the OAuth `full_name` claim and cleared the values already stored; migration **077** re-pointed the five functions that read it onto `username` and dropped the column.)* **Precisely:** no name is stored in `public.profiles`, which is the anon-readable surface. An OAuth provider's own `full_name` claim still lands in `auth.users.raw_user_meta_data` — not anon-readable, never rendered, and ignored by the trigger — so "we store no name" is a statement about the data anyone can reach, not about the auth provider's payload | **Nobody — there is nothing to see** |
| `profiles.username` | `jasonjones1995` | Unique public handle (**5–20 chars** `[a-z0-9_]`, case-insensitively unique via a `lower(username)` unique index — not citext; **permanent after explicit selection** — v2.8/Q4 + v2.8.1/Q7 rulings). AI persona/system accounts are exempt with hyphenated `*-ai` handles (`^[a-z0-9]+(-[a-z0-9]+)*-ai$`) that only privileged roles may write — the hyphen-free human charset means no human can ever hold a `*-ai` name: @-mentions, invite-by-username, public URLs (`/u/[username]`) | Anyone |
| auth email | — | Login + email updates (invites, waiver results, trade offers, weekly recap, per notification prefs) | **No one in the league** — never rendered in league surfaces, exports, or system posts |

League UI renders **Team name — @username**. The username is the **only** name the product has; it is by definition the displayed name and we do not call it that (v2.9 ruling, 2026-08-05). Usernames are **permanent** (v2.8/Q4 ruling — no renames after selection; the auto-generated pre-selection placeholder is not a selection). League surfaces join on `user_id` regardless, and the audit log stores `user_id`. Email is the only private field left, because it is the only other field there is. *(The v2.7 text made usernames changeable; superseded. The v2.1–v2.8 "display name (@username)" render rule is superseded by v2.9.)*

**Requirements**
- **Create league** (free — v2.8 ruling; no `is_pro` gate): name, season, `team_count` ∈ {8, 10, 12, 14, 16} (v1 — see changelog v2.6), and a settings wizard (7.3). Creator becomes `commissioner` and gets a team.
- **Invite** three ways (v2.1, email elevated v2.6), all funneling into one claim flow (link → sign-up/sign-in → seated):
  1. **League share link** (`leagues.invite_code`, already exists) — multi-use, rotatable, with an optional **custom slug** (`fieldscout.gg/join/<slug>`, unique, commissioner-set; falls back to the random code). Joins the claimer as a member the commissioner then attaches to a team (or auto-creates a team while open seats remain).
  2. **Seat-targeted invite by email** *(v1's primary path — most invitees don't have a FieldScout account yet)* — commissioner types an email address for a specific franchise ("You've been invited to manage **Team 4** in *Yardboats League*"); a `league_invites` row (§12.23) is created with `invited_email` set and a real email is sent with a claim link. Works identically whether the address belongs to an existing account or not: an existing user is prompted to sign in; a new visitor is directed to sign up **with the email this invite was sent to**, and the server-side claim check (E65) is the gate. *(Erratum v2.8.10: the pre-auth `/join/[token]` page cannot pre-fill/lock the field to `invited_email` — the F2 invariant forbids `get_join_preview`, the only pre-auth surface, from disclosing the invited email to an unauthenticated visitor. Correctness does not depend on the pre-fill: `claim_league_invite` validates the signed-in user's email against `invited_email` case-insensitively and refuses on mismatch (E53). The "lock" was a convenience that surface cannot safely provide.)* Claiming seats the user on that exact team and opens their first manager stint (§7.2.1) — this is how a replacement GM inherits a specific team.
  3. **Seat-targeted invite by username** — commissioner types `@tim_boris02` for an existing FieldScout user; same `league_invites` mechanics with `invited_username` set instead, plus an in-app/email notification. Requires the invitee already have an account, so it's the secondary path.
  4. **Seat-targeted invite by copyable link** — same token, no username/email restriction; commissioner shares it themselves (text, Slack, group chat).
- Invites expire (default 14 days), are revocable, and every send/claim/revoke is recorded (the invite funnel of §16.4).
- **Join** with invite code (free — v2.8: creation is free as well, so no Pro gate exists anywhere on the create/join surface). On join, a `teams` row is created for the manager with `league_id` set.
- **Placeholder/managed teams.** Commissioner can create empty seats (a `teams` row owned by the commissioner, flagged `is_placeholder`) so the draft can run before everyone has joined; ownership can be reassigned to a real user later (audited).
- **Roles.** Commissioner can promote a manager to `co_commissioner` (full powers, audited) or demote. Exactly one `commissioner`; multiple `co_commissioner` allowed. The original creator can never be removed by a co-commissioner.
- **Kick/replace.** Commissioner can remove a manager at any time; what happens to the *franchise* is a first-class, explicit choice — **takeover · retire-and-succeed · vacate/autopilot** — defined in **§7.2.1**. All paths post-draft are audited overrides.
- **Capacity.** Cannot start a draft until the number of active teams equals `team_count` (commissioner may override to draft short — audited — with empty seats auto-set to autopick).

### 7.2.1 Franchise & manager lifecycle (NEW v2.1) — teams outlive managers

**Model: a franchise is not its manager.** A `teams` row is a durable *franchise* in the league (name, roster, record, FAAB, draft slot, H2H history). People hold **manager stints** on a franchise (`team_managers`, §12.22): who ran it, from when to when, and why the stint ended. `league_members.user_id`/`team_id` remain the *current-state* cache; stints are the historical truth. This one separation is what makes replacement, history attribution, and the audit story coherent — without it, reassigning a team silently rewrites the past (v1.x behavior: jasonjones1995's whole tenure would be re-credited to his replacement).

**When a manager leaves (removed by the commissioner or leaves voluntarily), the commissioner picks one of three outcomes:**

**(a) Takeover — franchise continuity (default).** `tim_boris02` opens a new stint on Team 4 and inherits the franchise whole: roster, W-L, FAAB balance, waiver position, draft assets, H2H record, and name (renameable). History Mode shows the franchise with its stint timeline — *jasonjones1995 (Wk 1–8) → tim_boris02 (Wk 9–)* — with per-stint splits. This is the right call mid-season and matches what real leagues do when a friend adopts an abandoned team.

**(b) Retire & succeed — franchise shutdown.** Team 4's identity is **sealed** with jasonjones1995 as its only-ever (or final) manager: `teams.status='retired'`, name/record frozen, permanently visible in History Mode under his name. A **successor franchise** is created into the same league *slot* (`successor_team_id` links them): it takes over the schedule position and — because a 12-team league must keep fielding 12 teams — inherits the roster, FAAB, and remaining draft assets as-is. **Standings rule:** the successor inherits the W-L record *for seeding math only* (a mid-season 0-0 team would break playoff qualification); History Mode partitions the ledgers, so the retired franchise's results stay under jasonjones1995 and the successor's book opens at its founding week. (The NFL analogy the UI can borrow: the Browns' records stayed in Cleveland; the Ravens started a new book.) Retirement is primarily an **offseason** action; mid-season it's allowed as an audited override with the standings-inheritance rule shown in the confirm dialog.

**(c) Vacate — no replacement yet.** The stint closes with no successor: `teams.status='orphaned'` (autopilot). Lineups auto-set (last valid, healthy-substitution per existing autopick logic), open trade offers involving the team auto-rescind, pending waiver claims cancel, no new transactions. The commissioner may act **as** the team (set a lineup, accept a fair trade) — every such action is logged with `acting_as_team_id` and rendered in the activity feed as "Commissioner (acting for Team 4)". Orphaned is a holding state that resolves into (a) or (b).

**Removal mechanics (all paths).**
- Access ends the instant the stint closes: league write access derives from the **open stint** in RLS/RPC checks, so a removed manager's live session can write nothing — no race window, no cleanup job.
- The removed user's chat messages, transactions, and audit entries are **retained under their identity** (immutable history; @username keeps rendering).
- The removed user is notified with the outcome category (removed / left / franchise retired) and can be **re-invited later** — to any team, including their old franchise (a second stint on the same team is just another row).
- Removal **during a live draft** flips the seat to autopick on the same pick clock (existing §8 machinery); the stint mechanics are identical.
- Voluntary leave uses the same flow with `end_reason='left'`; a commissioner cannot leave without first transferring the `commissioner` role. On a voluntary leave, **both** the departing user (the `left` category above) **and** the sitting commissioner are notified (v2.8.9 ruling).

**Generalized "Act as Manager" (v2.6) — for a still-seated manager who's gone quiet.** Vacate (c) requires formally closing the stint — the right call once you've decided a manager is truly gone. But the common early case is softer: the manager is still in their seat, just unresponsive (no lineup set in weeks, ignoring waivers), and the commissioner isn't ready to remove them yet. For that, **acting-as is available for any team in the league, at any time, with no stint change required.** From a team's page, the commissioner selects "Act as [Team]," takes whatever action is needed (set a lineup, submit a claim, accept a trade), and every action is tagged `acting_as_team_id` and posted to the activity feed as "Commissioner (acting for Team 4)" — identical treatment to the orphaned case, just without requiring orphaned status first. The real manager's access is **never locked** during this — if they come back and act too, both actions land, each correctly attributed in the activity feed and audit log to its true actor (commissioner vs. manager), last write wins. No new persistent state: this reuses the existing `acting_as_team_id` tagging already built for orphaned teams (§12.12) — the only change is that the UI stops gating the "Act as" entry point behind orphaned status.

### 7.3 Settings catalog
All settings are editable in `setup`/`scheduled`. After the draft, structural settings (roster slots, team count, scoring categories) become **commissioner-override-only** (changing them mid-season is allowed but logged and warned). Store settings as typed columns where queried often, and in a `settings JSONB` blob on `leagues` for the long tail (see §12 schema). **Defaults below are the league-creation defaults.**

Legend: **D** = default · **R** = allowed range/options.

#### 7.3.1 Format & structure
| Setting | D | R / Options | Notes |
|---|---|---|---|
| `format` | `redraft` | redraft (only one enabled v1; keeper/dynasty/best_ball reserved) | Drives draft + offseason logic. |
| `team_count` | 12 | **8, 10, 12, 14, 16** (v1) | Even only in v1; 18/20 and odd counts are v1.1 (OQ 12). 16-team leagues: validate the draftable player pool (§7.3 validation). |
| `divisions` | 1 | 1–2 (v1) | If 2, must split evenly; used for standings & playoff seeding. |
| `regular_season_weeks` | 14 | 12–15 | Must leave room for playoffs within weeks 1–18. |
| `playoff_teams` | 6 | 0, 2, 4, 6, 8, 10, 12 (≤ team_count) | 0 = no playoffs (points-only champion). |
| `playoff_start_week` | 15 | 13–16 | **= `regular_season_weeks` + 1** (strict continuity, §7.3.8 — Q10 ruling, v2.8.6). Effectively derived; 13 reachable only at a 12-week season, 16 only at 15. |
| `playoff_weeks_per_round` | 1 | 1–2 | 2 = two-week rounds. |
| `playoff_byes` | auto | derived from bracket size | Top seeds get byes when bracket > playoff_teams. |
| `playoff_reseed` | true | true/false | Reseed each round by seed. |
| `consolation_bracket` | false | true/false | "Toilet bowl" for non-playoff teams. |
| `third_place_game` | false | true/false | |
| `schedule_mode` | `h2h` | `h2h`, `total_points` | v2.0. Total-points = no matchups; standings by cumulative PF (§11.7). |
| `median_game` | false | true/false | v2.0. Sleeper-style extra weekly game vs the league median (avg of the two middle scores; equal = tie). Regular season only (§11.7). |
| `second_opponent` | false | true/false | v2.0. Yahoo-style second H2H matchup each week (never your primary opponent). Stackable with `median_game` (§11.7). |

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
- **"DL" preset (v2.0, product naming):** the roster builder ships a one-tap Restricted-IR preset labeled **DL** — designations **OUT, IR, Doubtful**, `min_weeks = 4`. Identical mechanics to any Restricted spot; the label is the product promise ("whoever goes on the DL stays 4 weeks, even if healthy").
- **`min_weeks` (restricted only):** default **4**, range 1–17. Tenure is counted in NFL weeks: placed in week *W* → removable in week *W + min_weeks*.
- **Enforcement:** IR'd players never count toward the lineup and score nothing; if an IR'd player loses eligibility (returns to active) the roster is flagged illegal until they're moved off — but a Restricted player still cannot be removed before the stint completes (commissioner override available). All IR moves respect lineup-lock timing. Tenure is tracked on `league_rosters` (`ir_placed_week`, `ir_lock_until_week`, §12.7).

**Swap spot rules (optional; one armed auto-substitution).** A Swap spot lets a manager designate a **bench player to auto-start if a chosen starter is knocked out** — before the game or during it. It's a safety net, not a free roster slot. Surfaced in all UI copy as **"Hot Swap"** (§16.4).
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

#### 7.3.3 Scoring (v2.2 — templates only in v1; advanced-stat scoring is the differentiator)

**Product thesis.** Box-score scoring pays for *where the ball ended up*; FieldScout pays for *who moved it*. FieldScout is the **first fantasy platform where advanced stats — completed air yards, yards after the catch, and yards after contact — are scorable categories**, so a player's fantasy output tracks his actual game impact. (Category audits of ESPN/Yahoo/Sleeper/Fantrax/MFL: none offers any tracking- or charting-derived scoring category. Verify the "first" claim once more before marketing copy ships — see Appendix A.0.)

- **v1 scope: template picker, not an editor.** The commissioner picks **one of 8 fixed templates** at creation; no per-category editing in v1 (full custom scoring returns in v1.1 as an unlock — the engine already supports it, the cut is UI + QA-matrix scope). A user's personal `scoring_systems` (existing app feature) cannot be attached to a league in v1. *(v2.11 — partial reversal for the 2026 test cohort per delivery-plan v1.4 + C37: the cohort gets the **custom scoring editor** defined in §7.3.3.1 below. Templates-only remains the GA default posture until the editor's own quality gate passes; the personal-systems attach bar stands — the only custom system a league can reference is the one forked from a template via §7.3.3.1's flow.)*
- **The 8 templates** *(v2.7: v1 ships the **6 parity templates only**; the two FieldScout templates return when advanced stats are funded)* (system-owned `scoring_systems` rows, `is_template = TRUE`, `owner_id NULL`; full point tables in **Appendix B**):
  | Template | One-liner |
  |---|---|
  | **ESPN Standard** | ESPN's defaults, 0 PPR |
  | **ESPN Full PPR** | ESPN's defaults, 1.0 PPR |
  | **Yahoo Standard** | Yahoo's defaults, 0 PPR (note: −1 INT) |
  | **Yahoo Half PPR** *(Yahoo's platform default)* | Yahoo's defaults, 0.5 PPR |
  | **Sleeper Standard** | Sleeper's defaults, 0 PPR |
  | **Sleeper Full PPR** *(Sleeper's platform default)* | Sleeper's defaults, 1.0 PPR |
  | **FieldScout Alpha** | *The catch, re-scored.* Receiving yardage split into completed air yards + YAC (YAC pays double). 100% live-capable stats. |
  | **FieldScout Ultra** | *Every yard credited to who earned it.* Alpha + rushing split by yards after contact + QB sack penalty. Charted stats settle next morning (§23.5). |
- **Parity guarantee:** each platform template matches that platform's *published* defaults in **every** category (e.g., ESPN INT −2 vs. Yahoo/Sleeper −1; per-platform K and D/ST tables) so a migrating league's scores feel identical. Values in Appendix B are best-known as of July 2026 and **must be re-verified against each platform's official help pages at build time** (they drift). *(Erratum v2.8.5 — Q9, ruled 2026-07-22: ESPN parity carries three **named exceptions**, not pending categories — a made 60+ FG scores as `fg_50_plus` 5 (ESPN: 6), and the D/ST PAT-safety (+1) / PAT-return (+2) micro-categories are unscored — because no current provider signal can observe them (Sleeper's `fgm_50p` aggregates everything ≥50); combined order ~5–15 plays league-wide per NFL season. Permanently-pending keys would manufacture a standing E61 badge on every ESPN league every week — strictly worse than a documented exception. The exceptions are user-visible in the ESPN templates' `description` (plain-language line, pinned by test), and lift if the September F10 raw-endpoint inspection finds a Sleeper 60+ FG spelling or PAT-play detail — then expressing the tier becomes a one-PR §23.5 data task.)*
- **Template gating by data capability (§23.5):** Alpha requires the `tracking` feed (air yards + YAC — live-capable); Ultra additionally requires the `charted` feed (yards after contact — lands T+1). If a feed isn't yet contracted for the environment, the template renders as "coming soon" rather than silently scoring zeros. Beta can ship Alpha before Ultra. **v2.3:** Alpha/Ultra additionally sit behind a per-environment **feature flag** — v1 launch does *not* require them to function. The launch bar is the 6 parity templates plus the pipeline below; lighting up Alpha/Ultra later is a config change, not a release.
- **Decimal/fractional scoring:** on by default (advanced-stat coefficients require it).
- **Scoring snapshot (v2.0, integrity fix):** on draft start (and on any commissioner scoring change), the template's full `rules` JSONB is **frozen into `leagues.scoring_rules_snapshot`**; all scoring — live, finalization, rescoring — reads the snapshot, never the live `scoring_systems` row. (Unchanged from v2.0; templates make the source row effectively immutable anyway.)
- **Precision & rounding (v2.0, determinism rule):** per-player weekly fantasy points are computed at full precision and stored rounded **half-up to 2 decimals** (`NUMERIC(8,2)`); a team's score = the sum of those rounded per-player values. Ties at 2 decimals are real ties (E38). *(Erratum v2.8.4: "half-up" = round half **away from zero**, matching what `NUMERIC(8,2)` assignment does — `−0.005 → −0.01`, live-verified on the stack (M1 batch-5 review, R57; PROGRESS D57(2)). The strict toward-+∞ reading of "half up" diverges from the column type at negative half-cent boundaries (all-miss K weeks, INT-heavy QB weeks) and is NOT this rule; the shipped calculator (`roundHalfUp`, `src/lib/leagues/scoring/calculator.ts`) pins the away-from-zero reading.)*
- **Template picker UX (§16):** side-by-side compare + a **"same game, scored three ways"** widget — pick any real player-week and see his points under Sleeper PPR vs. Alpha vs. Ultra with the yardage split visualized (air vs. YAC; before vs. after contact). This is the product's best pitch and doubles as marketing surface. *(v2.7: the widget is deferred with Alpha/Ultra — the v1 picker is the 6 parity cards + side-by-side compare.)*
- **Calibration rule (house templates):** Alpha/Ultra coefficients below are structural defaults, **calibration-pending**: before GA, backtest against the recorded 2026 fixture season (delivery plan M0/M1) and tune so each position's league-wide weekly mean lands within **±10% of Half-PPR** — familiar totals, redistributed toward impact. Publish the backtest ("impact correlation") as launch content.
- **Extensibility contract (v2.3 — the actual v1 requirement for advanced stats):** what must ship at launch is not Alpha/Ultra working — it's a scoring system where **adding a new scorable stat is a data task, not an engineering project**. The calculator is a **generic dot-product**: `score = Σ rules[key] × stat(key)` over whatever keys the league's snapshot contains; rules keys with no matching stat resolve to *pending/0* (honest badge, §23.5), stat keys with no rules entry are ignored. New stats land in `player_stats.advanced` JSONB (no migration), get one provider-adapter mapping + one `STAT_KEYS` registry entry, and become scorable via a template-row update — zero calculator or engine changes (full checklist §23.5).

##### 7.3.3.1 Custom scoring editor — 2026 test cohort (NEW v2.11; C37 ruling, Chris 2026-08-15)

*Un-punts the v2.7 templates-only cut for the invite-only test cohort (delivery-plan v1.4 "alpha focus: auction + custom scoring"). Product requirements are Chris's, recorded verbatim in `docs/specs/tasks-M3-auction.md` §9 C37; this section is their reconciliation with the calculator/snapshot law above. **Everything else in §7.3.3 stays LAW** — snapshot semantics, precision/rounding, the extensibility contract, template parity. Free for everyone (no `is_pro` gate — Pro suspension, CLAUDE.md 2026-08-03). Build is NOT authorized by this section alone: a follow-up Architect task breakdown (its own doc, after Chris approves this entry) cuts the tasks; this is a **separate parallel track, never an M3 lane** (C37).*

- **Product shape (Chris's four requirements).** **(1) Scoring is configured BY POSITION** — the editor steps through positions (QB → RB → WR → TE → K → D/ST; K and D/ST **are** editable, one single-section page each — Q12 ruled 2026-08-16), each position entering its scoring; not the industry's global category style. **(2) An "All Positions" switch per section** applies that section's values to every position; per-position customization stays possible afterward. **(3) Every position except K and D/ST carries five sections:** Rushing · Passing · Receiving · Special Teams (`return_td` at launch; return *yards* when a source is found — Q13 ruled, see the Special Teams bullet) · Turnovers (fumbles, interceptions). **(4) A live example player per position** whose fixed sample stat line recomputes as values are edited; sample players are FIXED — **Dan Marino (QB), Randy Moss (WR), Adrian Peterson (RB), Gronk (TE)**.
- **Entry point (compose, don't fork the UI):** the §16.2 `scoring-template-picker` gains a **"Customize"** affordance — picking a template as the starting point **forks** it into a new `scoring_systems` row (`owner_id` = commissioner, `is_template = FALSE`, name defaulting to "<League> Custom"), which `leagues.scoring_system_id` then references. Templates themselves are never edited (the D59 ownerless CHECK stands). Pre-existing personal `scoring_systems` rows remain unattachable (they live in the legacy research namespace — D33's one-namespace rule forbids a translation layer).
- **Rules document, format 2 (the data-model decision).** `scoring_systems.rules` (and therefore `scoring_rules_snapshot`) gains a versioned **base + per-position-override envelope**:
  ```json
  { "format": 2,
    "base":      { "<stat_key>": <coef>, ... },
    "positions": { "QB": { "<stat_key>": <coef>, ... }, "RB": {}, "WR": {}, "TE": {}, "K": {}, "DST": {} },
    "tier_cuts": { "def_pa": [0, 1, 7, 14, 18, 28, 35, 46],
                   "def_ya": [0, 100, 200, 300, 350, 400, 450, 500, 550] } }
  ```
  A flat `{key: coef}` map (no `"format"` member — `format` is not a registry key, so the discriminator is unambiguous) is **format 1** and stays valid everywhere forever; all 6 templates remain format 1 and byte-identical. **Effective rules for a player of position P** = `{...base, ...positions[P]}` (override wins; an explicit `0` override switches a category off for that position — the D59(4) score-inert convention; a position absent from `positions`, including any position outside the six, resolves to `base` alone). Resolution is a **pure resolver in front of the calculator** — `scorePlayerWeek(resolveRules(doc, player.position), stats)` — so the D33/D57 calculator stays untouched and key-agnostic. For a format-1 doc the resolver is the **identity for every position** (property-pinned), which is the backward-compatibility guarantee: **no existing template league's scored outcome changes by even a cent.** Pending/E61 semantics are unchanged (the resolver only selects rules keys; delivery is still the stat side's business).
- **"All Positions" switch = derived state, not stored state.** A section shows All-Positions ON iff none of its keys carry a position override (its values live entirely in `base`). Editing with the switch ON writes `base`; editing a specific position writes `positions[P]`. **Normal form at save:** overrides equal to the base value and empty override objects are stripped — so the switch state round-trips from the document alone (the `src/lib/leagues/settings/` round-trip discipline applies to the doc shape).
- **Editable scope (test cohort):** the editor exposes exactly the registry keys with `scoring_surface: 'scorable'` (§23.5 v2.11 — the mechanical predicate; today that is the `core_box` column/derived keys the 6 templates draw on). Grouped per position into the five sections above; **K** = the Kicking table (one section page), **D/ST** = the D/ST page: the event categories plus its tier tables (see the D/ST tiers bullet below). **Section catalog (pinned — the ops layer renders this, never invents):** Passing = `pass_yards`, `pass_tds`, `pass_2pt`, `qb_sack_taken` · Rushing = `rush_yards`, `rush_tds`, `rush_2pt` · Receiving = `receptions`, `receiving_yards`, `receiving_tds`, `rec_2pt` · Special Teams = `return_td` (+ `return_yards` when its Q13 data task lands — code-gated, the C43 pattern) · Turnovers = `interceptions`, `fumbles_lost`, `fumble_recovery_td` · Kicking (K) = `fg_0_39`, `fg_40_49`, `fg_50_plus`, `pat_made`, `fg_missed`, `pat_missed` · D/ST (DST) = `def_sack`, `def_int`, `def_fumble_rec`, `def_td`, `def_safety`, `def_block`, `def_return_td` + the doc's tier tables. **Per-field bounds:** finite, **|coef| ≤ 100**, **max 2 decimal places** (multiples of 0.01 — every template value fits; NUMERIC(8,2) rounding law unchanged). Context/raw/aggregate keys, `deferred`-storage bonus keys, placeholder advanced keys, and IDP are **not editable** (v-next list below).
- **Special Teams — ships with return TDs; return yards drop in later as a SMALL, pre-specified change (Q13 RULED 2026-08-16: "ship with return TDs with the ability to easily add yards when we find a source").** At launch the section contains `return_td` only, because `return_yards` has no registry key, no `player_stats` column, and no provider mapping today — and a rules key whose stat is never delivered is a standing E61 pending badge (the Q9 lesson). **"Easily" is a requirement on this design, so the future data task is a checklist, not a discovery exercise** — when a source is found it is exactly: (1) map the feed field in the provider adapter into `player_stats.advanced` (**no migration** — §23.5's storage rule); (2) add one `STAT_KEYS` entry (`return_yards`, tier `core_box`, `storage: 'advanced'`, `scoring_surface: 'scorable'`); (3) add the key to the Special Teams section catalog and **flip its code gate on**; (4) done — the calculator, the resolver, the guardrails, and the editor's rendering are all key-agnostic and need no change. To keep step (3) trivial the editor renders its sections **from the catalog**, and the gated field is a catalog flag — never a hand-written form row. Nothing about the format, the snapshot, or scoring changes when it lands; existing docs simply gain an available key they may set.
- **D/ST tiers — how defense scoring actually works, and what the editor exposes (RULED 2026-08-16).** *Correction of an earlier draft of this section, which offered "the PA/YA bucketization as a preset set" and wrongly implied points-allowed and yards-allowed are alternatives to pick between.* **They are not alternatives: they are two independent tables that pay additively** — a defense's week is its event categories **plus** its points-allowed tier **plus** (where the model carries one) its yards-allowed tier. What actually differs between the platform families is **where the tiers are cut**: the ESPN family cuts PA at 14–17 / 18–27 / 35–45 / 46+, the shared (Yahoo/Sleeper) family at 14–20 / 21–27 / 35+ — and ESPN pays a YA table on top while the single-model platforms pay PA only (the `dst_model` distinction, D44). Each table owns its own cut list; PA and YA have different domains and never share one.
  - **(a) The format reserves per-league boundaries NOW, even though the UI ships later** *(the deciding reason: cut points can only live in the league's own scoring document, so bolting them on later would force a **third** format version plus a migration of every stored doc and a re-proof that every frozen draft snapshot still scores identically. Deciding the slot now costs nothing; deciding it later costs a migration.)* — hence `tier_cuts` above. **Tier keys are GENERATED from the cut list**: tiers are `[cut, next_cut)` with the last open-ended and the first open-below, named `def_pa_<lo>_<hi>` (single-value first tier → `def_pa_0`; final tier → `<lo>_plus`). **Verified: this rule regenerates today's three families byte-exactly** — ESPN PA `[0,1,7,14,18,28,35,46]` → the 8 ESPN keys, shared PA `[0,1,7,14,21,28,35]` → the 7 shared keys, YA `[0,100,200,300,350,400,450,500,550]` → the 9 YA keys (checked against `templates.ts`; **pin this equivalence by test** — it is the whole backward-compatibility argument). Because a fork always writes the inherited family's cuts, the generated key set is identical to the template's literal keys, so a doc carrying `tier_cuts` scores the same whether the engine derives from cuts or from `derive-stats.ts`'s literals — the two readings agree by construction until boundary editing ships (**invariant to pin**; the derive helper gains an optional cuts parameter defaulting to today's literals, no behavior change).
  - **(b) First-version UI: boundaries are INHERITED, not editable.** The fork writes the starting template's cut lists (ESPN template ⇒ ESPN cut points) and the cohort editor shows the tier rows read-only-as-to-boundaries: **the commissioner edits what each tier PAYS**. No preset-set dropdown, no boundary fields, no adding/removing a table (turning a single-model doc into a split one is table structure, not a coefficient — same follow-up). **Boundary editing is its own task immediately after the editor — ledger row F59**, routed to a follow-up Architect breakdown, explicitly NOT in the cohort editor build.
  - **(c) When F59 builds, boundaries are entered as CUT POINTS, not ranges (design ruled now so the follow-up inherits it).** A single ascending integer list per table — e.g. `0, 7, 14, 18, 28, 35, 46` — with each tier derived as `[this cut, next cut)` and the last open-ended. This makes **overlapping tiers and coverage gaps structurally unconstructible** rather than validation-caught: freehand ranges admit both the F21 double-pay overlap *and* silent-zero gaps, while derived-from-cuts admits neither — the same "make the bad state inexpressible" posture as the guardrails below. Residual validation is trivial: **ascending, integers, ≥ 2 cuts**, per table, the two tables independent.
- **F21 guardrails (validation LAW, not UI hope — what a format-2 doc structurally cannot express):**
  1. **Scorable-allowlist:** every key in `base` and every override ∈ the `scoring_surface: 'scorable'` set. Raw sources (`def_points_allowed`, `def_yards_allowed`) and aggregates (`fg_made`, `fg_attempted`, `pat_attempted`, `pass_attempts`, `pass_completions`, `rush_attempts`, `targets`) are `context` — a doc paying a raw source *and* its derived buckets, or an aggregate *and* its split tiers, is **inexpressible**, not merely hidden.
  2. **Tier exclusivity (the F21 double-pay itself):** a format-2 doc's `def_pa_*` keys must be ⊆ the key set **generated by its own `tier_cuts.def_pa`**, and its `def_ya_*` keys ⊆ the set generated by `tier_cuts.def_ya`. Because one cut list per table generates one non-overlapping tier set, mixing families (e.g. `def_pa_14_20` + `def_pa_18_27`, which one-hot together at PA 18–20 and double-pay it) is **inexpressible** — the doc cannot name a key its own cuts don't generate. *(For format-1 docs — the templates — the equivalent check is the original one: `def_pa_*` ⊆ exactly one named platform family, shared 7-key XOR ESPN 8-key, the families sharing 4 key names; `def_ya_*` ⊆ the 9-key YA set. Per the §23.5 family definitions ≡ `derive-stats.ts` boundaries.)*
  3. **Position scope:** `positions` keys ⊆ {QB, RB, WR, TE, K, DST}; an override under P may only reference P's section keys (K keys only under K, D/ST keys only under DST, offense keys never under K/DST).
  4. **Normal form** (no-op/empty overrides stripped) and the bounds above.
  5. **Enforcement sites — server-authoritative, defense in depth:** client Zod is UX only; the server write path (editor save + settings attach) MUST reject an invalid doc, and **draft start MUST refuse to snapshot one** (extends the §7.3.8 validation bullet — a league can never enter `drafting` on an invalid doc; loud failure per CLAUDE.md, never a silently-ignored key). Exact RPC/route split is the breakdown's call.
- **Sample players & lines (fixed in spec so the UI is deterministic; recomputed through the REAL pipeline — `resolveRules` + `scorePlayerWeek`, never a parallel math path; pinned by hand-computed literals per the D62 discipline).** Lines contain only delivered stats (no pending badge inside the editor, by construction); context numbers (carries, attempts) render as flavor and score nothing:
  | Player (position) | Fixed sample line |
  |---|---|
  | **Dan Marino** (QB) | 24-of-36, 335 pass yds, 3 pass TD · 6 rush yds · 1 INT, 2 sacks taken |
  | **Adrian Peterson** (RB) | 22 carries, 121 rush yds, 1 rush TD · 4 rec, 23 rec yds · 1 fumble lost |
  | **Randy Moss** (WR) | 9 rec, 145 rec yds, 2 rec TD · 12 rush yds · 1 punt-return TD |
  | **Gronk** (TE) | 7 rec, 89 rec yds, 1 rec TD · 1 two-pt catch |
  | **Neil Rackers** (K) | 2 FG 0–39, 1 FG 40–49, 1 FG 50+ · 3 PAT · 1 FG missed |
  | **the Seahawks** (D/ST) | 3 sacks, 1 INT, 1 fumble recovery, 1 defensive TD · 17 points allowed, 289 yards allowed |

  Each position page shows its player's line with the live total under the doc-as-edited; the numbers above are product voice — Chris may amend them on this entry's PR without re-opening the mechanism. The D/ST line's 17 PA / 289 YA are deliberately *near a cut point in both families* (ESPN pays `def_pa_14_17`, shared pays `def_pa_14_20`; YA lands in `def_ya_200_299`) so the sample makes tier behavior visible rather than hiding it mid-bucket.
- **Lifecycle & snapshot (unchanged law, applied):** the editor is a `setup`/`scheduled` surface (§7.3 header); rules edits and template re-forks are free until draft start. On draft start the doc — format 1 or 2, **verbatim** — freezes into `scoring_rules_snapshot` (the §7.3.3 snapshot bullet is unmodified; resolution happens at scoring time from the frozen doc). Post-draft scoring changes stay the existing commissioner-override law and are **not** exposed through the cohort editor.
- **Access:** the commissioner edits; league members can view the league's custom rules pre-draft (additive `scoring_systems` SELECT policy, §12.25). Member visibility of *what changed* rides the settings surface, not a new feed.
- **QA-matrix posture (why this doesn't reopen the v2.7 cut):** templates stay format 1 and bit-identical, so the template QA matrix is untouched. The new surface carries its own suite: the resolver identity property (format 1 ≡ resolved, every position), fork-equivalence (forked template scores ≡ its template for all positions/lines), a named rejection test per guardrail, sample-line literal pins for all **six** sample players, the **cut-list ≡ today's key-names equivalence pin** for all three families plus the derive-agreement invariant (§7.3.3.1's D/ST bullet (a)), and the invalid-doc draft-start refusal.

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
| `player_game_lock` | **true** | true/false | v2.0. When on, an unowned player **locks for adds at their kickoff** and a rostered player **locks for drops at their kickoff**, until the week clears (§23.4 window). This is the strict "players lock as soon as their games start" rule; off reproduces lax incumbent behavior. Enforced via `league_player_pool.locked_until` (§12.19). |
| `bench_lock` | **true** | true/false | v2.0 (Sleeper-style). A waiver claim whose *drop* player has already played this week **fails at processing** (`drop_locked`, no FAAB spent). Off = the claim executes and the locked starter's stats still count for the dropping team (E33–E34). |
| `fa_hold_hours` | 0 | 0–48 | v2.0 (Sleeper's "24-hour rule", off by default). A free-agent add must be held this long before being droppable; earlier drops return the player to FA, not waivers. |

#### 7.3.5 Trades
| Setting | D | R / Options |
|---|---|---|
| `trade_review` | `commissioner` | `none` (instant), `commissioner`, `league_vote` |
| `trade_veto_votes` | ⌈team_count/2⌉ | 1–team_count (when `league_vote`) |
| `trade_review_period_hours` | 24 | 0–96 |
| `trade_deadline_week` | 11 | none or 1–regular_season_weeks |
| `allow_faab_in_trades` | false | true/false |
| `allow_future_considerations` | false | true/false (notes-only "gentleman's" trades; no draft picks in redraft) |
| `trade_lock_behavior` | `defer` | `defer`, `reject` — v2.0: if any included player's game is live at execution time, defer to the next lock-free moment or reject (E35). Rosters never change mid-game. |

#### 7.3.6 Lineups & lock
| Setting | D | R / Options | Notes |
|---|---|---|---|
| `lineup_lock` | `per_player_kickoff` | `per_player_kickoff`, `first_game_of_week` | Default matches incumbents. |
| `allow_illegal_lineups` | true | true/false | If true, byes/OUT score 0 (incumbent behavior). If false, the slot is blocked at submit. Either way, commissioner can flag & override (the differentiator, §10). |
| `auto_sub_inactives` | false | true/false | Optional Sleeper-style auto-sub of inactive starters from bench (§11.3). |
| `stat_correction_window` | Thu 06:00 ET | 0h–7d | v2.0. How long after the week official stat corrections auto-apply (§23.4). Incumbent norm: Sleeper through Thursday; Yahoo until the next week's first game. Matchups show `final (pending corrections)` until it closes. |

#### 7.3.7 Tiebreakers (standings & playoff seeding)
Ordered, reorderable list, applied whenever two or more teams are tied after the primary sort (Win %) — this is the same chain standings display uses and playoff seeding uses at end of regular season, so there's exactly one ranking rule in the product.

**v1 default (Chris's ruling):** **(1) Win %, (2) Points For, (3) Head-to-head, (4) Points Against — higher wins, (5) Division record (if divisions), (6) Coin flip (deterministic seeded).** Stored as an ordered array in `settings`; fully reorderable by the commissioner. (2)–(4) are the chain that actually matters for v1; (5)–(6) exist purely as a deterministic fallback for the near-impossible case all three tie exactly, and are candidates to trim later if you'd rather force a hard stop sooner.
- **Points Against direction is deliberate, not a typo:** the team that *allowed* more points played a harder schedule, so more Points Against ranks higher when Points For and head-to-head don't separate two teams.
- **Head-to-head only resolves a clean two-team tie** — the win-loss record between exactly those two teams' meetings that season. With three or more teams still tied after Points For, a round-robin comparison has no single well-defined winner (records can cycle: A beat B, B beat C, C beat A), so head-to-head is **skipped** for that group and the chain falls straight to Points Against (E63).
- **`total_points` leagues (§11.7) have no matchups, so no head-to-head data exists at all** — the chain skips directly from Points For to Points Against for those leagues (E64).

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
| `time_zone` | null | valid IANA zone name (or null) | *(Erratum v2.9.2 — D98/C27, additive)* The league's named draft reference zone (§16.4). **Display-only metadata**: instants (`draft_scheduled_at`, `drafts.current_deadline`) stay the authority; when set, league-time renders in this zone (Intl), when null the stored-offset render stands. The draft-setup surface offers the scheduler's own zone as the one-tap default. |

**Validation rules (enforced in API + DB constraints):**
- `team_count ∈ {8,10,12,14,16}` (v1).
- `playoff_start_week = regular_season_weeks + 1` — strict continuity (Q10 ruling, v2.8.6): the playoffs begin the week after the regular season ends; no overlap, no gap weeks. Applies regardless of `playoff_teams` — the field is effectively derived (§7.3.1), so a points-only league (playoff_teams 0) stores the consistent value too.
- `playoff_start_week + (playoff_rounds × playoff_weeks_per_round) − 1 ≤ 18`.
- Sum of starting slots ≥ 1 and ≤ 20; `roster_size` large enough that `roster_size × team_count` ≤ draftable player pool.
- Every starting slot has a unique `key` and a non-empty `eligible` set; **flex slots list ≥ 2 eligible positions**, single-position slots exactly 1; `bench` 0–20 and 0–6 IR spots.
- Each IR spot has a `type` (`unrestricted` | `restricted`) and ≥ 1 eligible designation; **restricted** spots set `min_weeks` ≥ 1 (default 4).
- A Swap assignment (when `swap_spots = 1`): the *out* player is a current starter, the *in* player is on the bench with the **same `player.position`**; **at most one swap per team per week**; editable only before the swap's lock.
- Auction: `auction_budget ≥ roster_size × auction_min_bid` (every team can fill a legal roster).
- Exactly one scoring system referenced and readable by the league; on draft start its rules are snapshotted (§7.3.3) — a league in `drafting`+ must always have a non-null `scoring_rules_snapshot`. *(v2.11: the referenced row is a template OR the league's own §7.3.3.1 forked custom row — nothing else; a format-2 rules doc must pass the §7.3.3.1 guardrail validation, and draft start refuses to snapshot an invalid doc — loud failure, never a silently-dropped key.)*
- Schedule (v2.0): generation invariants of §11.7 hold (each team exactly once per week per game type; both home- and away-side uniqueness; repeats separated ≥ 3 weeks; divisions play 2× when weeks allow); `second_opponent` derangement never pairs a team with its primary opponent.
- Locks (v2.0): all kickoff-derived locks (lineup, add/drop, swap, trade-defer) are evaluated from `nfl_games.kickoff_at` at runtime — precomputed lock timestamps are forbidden outside `league_player_pool.locked_until`, which the `lineup-lock` job refreshes on every run (§23.3).

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
- A lightweight **`draft-tick` worker** (Supabase Edge Function invoked by pg_cron every ~5s while any `drafts.status = 'live'`, plus an immediate self-schedule on each action) checks for expired deadlines and performs the timeout action atomically (autopick, or in auction: assign to current high bid / advance nomination). This mirrors the existing two-speed cron pattern in `docs/02-TECHNICAL-ARCHITECTURE.md`. *(Erratum v2.8.13 — the vehicle (D87/C21, tasks-M2; migration 068): `draft-tick` ships as an in-database SQL RPC — `draft_tick()`, scheduled directly by pg_cron every 5s — no Edge Function, no HTTP hop; the repo has zero Edge Functions and its Vercel-cron floor is 60s. The "immediate self-schedule" is satisfied in-database: every action RPC sets the next deadline synchronously and the ≤5s cron enforces expiry (worst-case timeout-enforcement lag ~5s — the p95 pick→broadcast metric targets user actions, not timeouts); pg_net self-invocation is the recorded escape hatch if 5s proves coarse. The tick also owns the D94 auto-start scan: leagues in `scheduled` whose `draft_scheduled_at` has passed are created-if-absent and started each tick, so a league scheduled purely through the settings surface can never dead-end.)*
- Because enforcement is server-side, the draft is correct even if every client disconnects.
- **Soft timer option:** if `pick_timer_seconds = 0`, no auto-action; the clock is informational only (the commissioner advances things). Useful for casual/slow drafts. *(Erratum v2.10.3 — L.C1.2/migration 084: this is the SNAKE/LINEAR pick clock's option and does **not** reach an auction. `auction_nomination_seconds` (10–120) and `auction_bid_seconds` (10–60) are their own §7.3.8 fields with their own floors — there is no "0" among them — so an auction started with `pick_timer_seconds = 0` still opens with a nomination deadline and the tick still enforces both auction clocks. An untimed auction is not expressible in v1, deliberately: nomination and bid clocks are what make §8.6.7(b)'s no-raise award and §8.6.8's progress guarantee reachable at all.)*

### 8.3 Draft order
- **Snake/linear:** `draft_order` is an array of `team_id`s, set by `draft_order_mode` (random/manual/custom). Snake reverses each round; `snake_reversal` flips round 3. Linear repeats the same order every round.
- **Auction:** `nomination_order` is circular; `nomination_order_mode` controls it.
- Commissioner can edit order until the first pick (and after, as an override).
- A "Randomize Order" action with a visible animation (and an optional reveal screen) is supported; the result is written before the draft starts.

### 8.4 Queue & autopick
- Each manager has a personal **queue** (`draft_queues`): an ordered list of `player_id`s. Drag to reorder; players already drafted are auto-removed/skedaddled. *(v2.10 naming rule — Chris, 2026-08-15: the queue is surfaced in ALL user-facing UI as **"Targets"** — room tab, load-a-list actions, autopick copy ("Timeouts draft from the top of your Targets first"), empty states. Schema, API and internal names — `draft_queues`, the queue routes/RPCs — are unchanged; this is UI copy + component-label scope only.)*
- **Autopick strategy** (`queue_then_board_then_adp`): on timeout or when a manager is in auto mode, pick the highest available from (1) their queue, else (2) their **primary league-tagged draft board** if they set one (§7.4), else (3) their FieldScout season-long Big Board order, else (4) lowest `players.adp`. The pick must fit an open slot (respect roster needs: don't autopick a 3rd QB into a 1-QB league if other needs are open — "best available that fills a need"). **K/D-ST deferral (v2.0):** autopick treats K and D/ST as ineligible until the team's remaining picks equal its remaining required slots or the draft is within its final 3 rounds — no bot takes a kicker in round 3 (E30).
- Managers can toggle **"Auto-draft me"** (e.g., if they have to leave). Commissioner can toggle it for any team.

### 8.5 Snake draft flow
1. Room opens at `draft_scheduled_at` (or commissioner clicks **Start Draft**). Status → `drafting`.
2. Board shows: full pick grid (rounds × teams), available players (searchable/filterable, with FieldScout Big Board / tiers / ADP overlays), the on-the-clock team, the pick clock, my queue, my roster (slots filling up), and draft chat.
3. On the clock: the active manager selects a player → RPC validates (their turn, player available, fits roster *(Erratum v2.8.11: at manual pick time "fits roster" = capacity only — the advance math guarantees each team exactly `total_rounds` picks and rounds = draftable spots (D91); need-fit is §8.4 autopick's rule, and E16's bipartite slot-fit is M4's lineup validator — PROGRESS D105(7), tasks-M2 §1)*) → writes `draft_picks` row → advances to next picker, resets clock → Realtime broadcast updates everyone.
4. Timeout → autopick (§8.4).
5. Disconnect → after `disconnect_grace_seconds`, that team flips to autopick for the current pick; reconnect restores manual control. Presence (§9) shows who's online. *(Erratum v2.8.13 — the D102 mechanism (spec-absent schema; migration 068): connectedness is read from `draft_liveness(draft_id, user_id, last_seen_at, PK(draft_id, user_id))` — a heartbeat table written ONLY by the `draft_touch` RPC the room calls (~15s cadence + visibility change); deliberately its own table, never a `drafts` column, so heartbeats never contend with the draft-row lock; no client DML, no client SELECT, no broadcast (Presence stays the UI's who's-online source). A seat is FRESH while ≤ 2 beats are missed (45s — a pinned constant). At deadline expiry: `is_autodraft` seats, no-user seats (placeholder/vacated — E48), and FRESH seats autopick immediately (step 4); a STALE seat's pick is held open until deadline + `disconnect_grace_seconds` — a returning manager may pick manually during the hold (this step's "reconnect restores manual control"/E3) — then autopicks.)*
6. Repeat until every roster is full. Status → `in_season`; initial `league_rosters` are populated from `draft_picks`.

### 8.6 Auction draft flow
1. Room opens; each team shows remaining **budget** and **max bid** (`budget − (open_slots − 1) × min_bid`).
2. The nominating manager (per `nomination_order`) nominates a player at an opening bid (≥ `auction_min_bid`); nomination clock enforces it (timeout → system nominates highest available or skips per setting). *(Erratum v2.12.1 — the mechanism (tasks-M3 C32/D129(2); migration 086, task L.C1.4): **there is no skip setting and there never was** — §7.3.8's catalog has never carried one, so v1 ALWAYS system-nominates on timeout. The `draft-tick` worker runs the ON-CLOCK team's own §8.4 autopick resolution chain (queue → primary board → Big Board → ADP, with the documented greedy need-fit) at an opening bid of `auction_min_bid`, and writes that opening as a `draft_bids` row like any other so §12.5 carries one uniform history. **§8.4's K/D-ST deferral maps to its FORCED-only arm in an auction:** the printed "within its final 3 rounds" escape is the snake/linear pick clock's — an auction has no rounds (`drafts.current_round` there is a display-only rotation lap), so K and D/ST stay ineligible until a team's remaining buys equal its unfilled required seats. **The §8.5.5 disconnect contract carries to this clock unchanged:** `is_autodraft` seats, no-user seats (E48) and seats FRESH as of the deadline are system-nominated AT the deadline, while a STALE seat's nomination is held open until deadline + `disconnect_grace_seconds` — and a returning manager may still nominate manually during the hold, exactly as they may pick manually during the §8.5.5 hold.)*
3. Open bidding: any manager with sufficient max bid raises. Each bid resets the bid clock per **anti-snipe** (`auction_anti_snipe_seconds`). Bids are validated against live remaining budget and required roster slots.
4. Bid clock hits 0 → highest bidder wins; `draft_picks` row written with `price`; budgets recomputed; nomination advances.
5. Inactive/disconnected managers do not auto-bid by default (configurable later); they can still be nominated for and simply don't participate.
6. Repeat until all rosters legal/full or budgets exhausted (engine guarantees every team can always complete a legal roster via the max-bid formula).
7. **Endgame rules (v2.0):** (a) nomination validates the nominator can afford their own opening bid; (b) a bid clock expiring with no raises awards the player to the **nominator at the opening bid**; (c) teams whose rosters are complete are **skipped in the nomination rotation** and cannot bid; (d) when a team's max bid is $1, only $1 bids are accepted for it; (e) system nominations on timeout pick the highest-ADP player that fits *some* team's open slot, skipping players no team can legally roster. (E25–E27) *(Erratum v2.12.1, **reasoning corrected v2.12.3** — (b) vs (e) reconciled (tasks-M3 C33/D129(2); migration 086, task L.C1.4). **The engine behaviour is unchanged and was never in doubt: a system nomination runs the on-clock team's own §8.4 resolution chain.** ~~v2.12.1 argued that (e) as printed can select a player the NOMINATOR cannot roster, so that (b)'s no-raise award would be illegal.~~ **That reasoning is withdrawn (D163/R374).** Under Chris's 2026-08-18 ruling the draft never consults positional legality — **capacity is a pure count** — and (c)'s rotation-skip already guarantees the nominator has an open slot, so there is no player the nominator "cannot roster" and no legality contradiction to reconcile. **The correct reason the system nomination runs the nominator's own chain is a quality-of-outcome one: an absent manager gets a player their OWN board would have picked**, rather than an arbitrary player some other team happened to need — and, as a by-product, (e)'s "fits *some* team's open slot" is satisfied a fortiori. One implementation serves snake timeouts and auction nominations; no separate cross-league search exists, and none is owed.)*
8. **Solvency invariant (v2.0):** `remaining_budget ≥ open_slots × min_bid` holds for every team at all times — including through commissioner budget edits and bid reversals, which are validated against it (a commissioner who needs more room reverses won bids instead; E28).

### 8.7 Commissioner live draft controls (explicitly required)
All available from a **Draft Commissioner Panel** overlay in the room; **every one writes a `commissioner_actions` audit entry** (§10) and broadcasts.

> **v2.12 — where these controls live in the room (Chris, 2026-08-17).** The panel is reached from **one place and one place only: the `Draft Options` menu in the room's 54px command bar** (§16.4). **Draft Options absorbs the entire commissioner panel** — the timer edits *and* undo, cascade undo, reassign / move a pick, force pick, edit order, autopick toggles, seat controls, Manual Edit Mode, Reset, and End Draft. The separate floating "Commish panel" button that M2 shipped **is retired**; a second door to commissioner power is exactly the thing this consolidates away. **Pause and Resume are the two exceptions** — they are first-class buttons *on* the bar rather than menu items, because they are the controls a commissioner reaches for while something is going wrong and they must not be two clicks deep. Nothing about the controls' *semantics*, refusals, audit obligations, or system-chat posts changes here — this is where the door is, not what is behind it.

| Control | Behavior |
|---|---|
| **Pause / Resume** | Freezes/refreezes all clocks. Unlimited. Banner shows "Draft paused by {commish}". On pause the remaining time persists to `drafts.deadline_remaining_ms`; on resume `current_deadline = now() + remaining` — clocks never gain or lose time across pauses (v2.0). |
| **Edit pick clock** | Change `pick_timer_seconds` live (applies to subsequent picks); may extend the current deadline. |
| **Undo last pick** | Reverts the most recent pick (player returns to pool, clock rewinds to that team). |
| **Undo to a point (cascade)** | Undo back to pick #N (everything after is reverted). Clear confirm dialog showing what will be undone. |
| **Edit / reassign a pick** | Change which player a given pick selected, or **move a drafted player to a different team** (drag a player from Team A's roster to Team B in the panel). Validates exclusivity & slots; writes before/after to the log. *(This is the "move players between teams easily if something breaks" requirement.)* |
| **Pick for a manager** | Make the current pick on behalf of the team on the clock (disconnect/AFK). |
| **Toggle autopick for any team** | Force a team to/from auto mode. |
| **Adjust auction budget / undo a won bid** | Correct a mis-click: reverse a winning bid (player back to pool, budget restored) or adjust a team's remaining budget. |
| **Reassign a draft seat** | Swap which user controls a team (e.g., a friend takes over for a no-show). |
| **Reset draft** | Wipe all picks back to pre-draft (status → `scheduled`). Hard confirm; fully audited; cannot be silent. |
| **End draft** *(v2.10 — AUCTION; RULED v2.10.1, Chris 2026-08-16: end-as-is)* | Ends an auction early, as-is: drafted players keep their prices, **unfilled roster slots stay empty**, league → `in_season`; free agency fills the gaps later. Hard confirm listing the consequences; fully audited; system chat post; cannot be silent. Solvency is trivially preserved (ending spends nothing); the completion writer accepts partial rosters. (OQ 19, ruled — option (a).) |

*(v2.10 — auction commissioner UX, ruled by Chris 2026-08-15; applies to AUCTION drafts:)*
- **Pause-first is REQUIRED** for: undoing picks (single + cascade), Manual Edit Mode (reverse/reassign/move), editing the current nomination, and ALL timer edits. These controls refuse on a running auction with a friendly "pause the draft first" — this supersedes the controls-available-live posture above **for auction**. (Snake keeps its shipped live-controls behavior; the divergence is recorded, alignment is a follow-up decision — PROGRESS ledger.)
- **Manual Edit Mode** *(replaces this table's "drag a player from Team A's roster to Team B" articulation for auction)*: the commissioner enters the mode, clicks any drafted player's cell → a modal with exactly two choices: **(a) "Reset pick"** — player returns to the available pool, the winning manager is refunded; **(b) "Move player to a different team"** — previous owner refunded, new owner charged $Amount, where the commissioner must **re-enter the cost** to confirm. Maps onto the reverse-won-bid and priced-reassign engine paths; validations (exclusivity, receiving-team solvency) unchanged.
- **Edit current nomination** *(while paused)*: cancel-and-renominate — the live nomination is voided (open bids voided, no award, the sequence number is NOT consumed), and on resume the same nominator renominates.
- Pause/Play, Reset, and every commissioner action remain **visible to all users** (system chat posts; §16.3).

**Disconnect/robustness requirements**
- Reconnect must restore the full room state in < 2s from the authoritative `drafts` + `draft_picks` snapshot (no reliance on missed broadcasts; client refetches state on reconnect, then resubscribes).
- If the commissioner disconnects, co-commissioners retain controls; if none, the draft auto-pauses after grace (configurable) so nothing runs unsupervised during an outage. *(Erratum v2.8.14 — the mechanism (D102/D108; migrations 068/069): the `draft-tick` outage arm reads commissioner/co-commissioner connectedness from `draft_liveness` (the §8.5.5 heartbeat table) and auto-pauses a live NON-mock draft when supervision was ESTABLISHED and then LOST — at least one commissioner/co-commissioner heartbeat row exists for the draft AND none is newer than now() − (the 45s freshness constant + `disconnect_grace_seconds`). Freshness here is evaluated AS OF NOW each tick — the deliberate contrast with the pick hold's as-of-deadline rule (R132): the outage check is a continuous present-tense supervision question with no fixed reference instant. A draft whose commissioners NEVER connected (zero heartbeat rows — e.g. a D94 auto-started room nobody opened) runs unsupervised BY DESIGN and is never outage-paused — this bullet's word is "disconnects", which presupposes a connection, and pausing never-attended drafts would defeat the D94 "absent rooms still draft correctly" contract (§8.5.4/E48 autopilot). The pause persists the remaining clock exactly like a manual pause (one bookkeeping implementation) and posts a system chat message; a returning commissioner ends the outage condition immediately but the draft NEVER auto-resumes — resume is a commissioner action.)*
- All ephemeral UI (who's typing, hover) uses Broadcast/Presence and is non-authoritative.

### 8.8 Draft chat & Mock Draft Mode (v2.3 — promoted from Phase-F nice-to-have to a core feature)
- **Draft chat:** real-time chat scoped to the draft (reuse `league_chat` with a `channel = 'draft:<draft_id>'`, or a dedicated `draft_chat`; spec uses `league_chat.context`). Commissioner override actions auto-post a system message into draft chat (non-disable-able) — Sleeper-style transparency.

**Mock Draft Mode — solo practice under the league's real settings.** One user drafts against CPU opponents with the actual countdown pressure; the product requirement is *timer fidelity*, not a toy.
- **Launch:** any league member starts a mock from a pre-draft league (`setup`/`scheduled`) — "Practice this draft." The mock snapshots the league's **real draft config** (type, pick clock, order incl. their actual slot, rounds from roster slots, anti-snipe) into a new `drafts` row with `is_mock = TRUE`. The human takes their real seat by default (any seat selectable); every other seat is a CPU.
- **Same engine, literally:** server-authoritative deadlines, `draft-tick` timeouts, autopick, pause/resume, queue, board — the identical code path as a live draft. A mock that behaves differently from draft night is worse than no mock.
- **CPU opponents = the simulator bots** (delivery plan §4.2) exposed in-product — one bot implementation, two consumers. Rankings/ADP-driven with roster-need awareness; **humanized timing** (picks land at a random 20–70% of the clock, with occasional near-buzzer picks so the user *feels* timeout and anti-snipe behavior); auction bots bid value-based (ADP-derived values ± noise) and pass the same max-bid/solvency validator as humans.
- **CPU speed toggle:** `realistic` (default) or `fast` (~2s CPU picks). Affects bot think-time only — the human's clock always runs real.
- **Zero side effects:** no `league_rosters`, no `transactions`, no league status transitions, no notifications to other members. Picks exist only under the mock `draft_id`; chat scoped to the mock room. Mock parameters live in `drafts.config.mock = { human_team_id, cpu_speed, launched_by, action_id? }` — no schema change (§12.3 already has `is_mock`). *(Erratum v2.8.16 — `launched_by` added as the D103(2) authorization key: the launcher is the mock's only legal human driver (pick on the human seat, pause/resume, delete), keyed on this value and never on seat ownership; every §8.7 commissioner control refuses mocks — an unguarded reset was a live-proven league write. Deleting a mock (owner or the expiry cron) explicitly removes its `draft:<mock_id>` chat rows — the chat FK is to the league, so CASCADE cannot reach them. Completed 2026-08-04, M2 batch 7 R149: an optional `action_id` — the launch-idempotency key (one UUID per client submit); a replayed submit returns the original mock instead of a second one, launcher-scoped, absent when the caller sends none.)*
- **Lifecycle:** pause/leave anytime (auto-pauses on disconnect); resumable from the league page; abandoned mocks auto-expire after **72h** (daily cleanup cron); a finished mock keeps a **recap** (full board + your roster vs. the CPUs') until the user deletes it. Cap: **3 active mocks per user** (§22.5). *(Erratum v2.8.16 — mechanics: the auto-pause fires when the LAUNCHER's heartbeat is stale past `disconnect_grace_seconds` + one tick (D93), always before the §8.5.5 grace hold could autopick the disconnected human; resume is the launcher's action, never the tick's. "Idle" for the 72h expiry = GREATEST(the mock's `updated_at`, the launcher's last heartbeat) — either signal resets the clock; completed recaps never expire.)*
- **Load accounting:** a mock is one realtime subscriber and rides the same SKIP-LOCKED `draft-tick`; cheap, but counted in the §22 draft-concurrency budget and load tests.
- **v1 scope:** league-attached only (config, roster shape, and the player pool come from the league). A standalone practice lobby with quick settings — and multi-human mock rooms — is v1.1.

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

Builds on the existing Supabase Realtime usage (`docs/02-TECHNICAL-ARCHITECTURE.md` §Real-time Features) — **revised in v2.0 for scale.** The v1.x design subscribed clients to **Postgres Changes** on league tables. Supabase's own guidance now warns against this at scale: Postgres Changes authorizes **every change against every subscriber** (1 write × 100 subscribers = 100 RLS checks) and processes all changes on a **single thread** to preserve ordering — throughput scales with subscriber count, not write rate, and larger compute doesn't help. With hundreds of leagues live on a Sunday, that design falls over. Supabase's recommended replacement is **Broadcast from Database**: DB triggers call `realtime.broadcast_changes()` to publish to **private, authorized Broadcast channels**, which scales to tens of thousands of concurrent subscribers.

**v2.0 transport rule: clients never use Postgres Changes. All authoritative table events reach clients via Broadcast-from-Database triggers on private channels.**

| Mechanism | Used for | Authoritative? |
|---|---|---|
| **Broadcast from Database** (triggers → `realtime.broadcast_changes()`) | The truth: `drafts` state, `draft_picks`, `draft_bids`, `matchups` score updates, `team_week_results`, `transactions`, `league_rosters`, `commissioner_actions`, `league_chat`, `lineup_swaps` | **Yes** — but clients treat each event as a *cache-invalidation + payload hint*; on any doubt they refetch via REST |
| **Presence** | Who is in the draft room / online; per-team connection status | No (ephemeral) |
| **Client Broadcast** | Ephemeral UX only: "typing…", bid-button pulses, optimistic intent echoes | No (ephemeral) |

### 9.1 Channels (all private; Realtime Authorization via RLS on `realtime.messages`)
- `draft:<draft_id>` — draft state, picks, bids, draft chat, Presence, a 15s server heartbeat for clock-drift correction. Fan-out ≤ 20 clients + spectators.
- `league:<league_id>` — matchup/score updates, transactions, roster changes, commissioner actions, league chat, swap events. Powers the activity feed, live standings, and the audit log.
- **No client subscribes to `player_stats` or `nfl_games`.** Raw stat deltas are ingested server-side and fanned out per league by the `score-league-week` worker (§22.2), which writes `matchups` / `team_week_results` and lets the table triggers broadcast one compact `scores_updated` event per league per batch. Per-player box-score lines are fetched via REST when a matchup view is open, re-fetched on `scores_updated`.

### 9.2 Trigger + authorization pattern
```sql
-- One trigger per authoritative table, e.g.:
CREATE OR REPLACE FUNCTION broadcast_draft_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.broadcast_changes(
    'draft:' || COALESCE(NEW.draft_id, OLD.draft_id)::text,  -- topic
    TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);
  RETURN NULL;
END $$;
CREATE TRIGGER tr_broadcast_draft_picks
  AFTER INSERT OR UPDATE ON draft_picks
  FOR EACH ROW EXECUTE FUNCTION broadcast_draft_changes();

-- Authorization: members may read their league/draft topics.
CREATE POLICY "members read league topics" ON realtime.messages
  FOR SELECT TO authenticated USING (
    (SELECT realtime.topic()) LIKE 'league:%'
    AND is_league_member(split_part((SELECT realtime.topic()), ':', 2)::uuid)
  );
-- (equivalent policy for 'draft:%' topics via drafts.league_id lookup)
```
- Column-select payloads: broadcast only the columns clients render (never blind-bid amounts, never private queue rows). Sensitive tables (`waiver_claims`, `draft_queues`) are **never broadcast** — owners poll/refetch their own rows.
- `realtime.send()` is used for synthetic events with no backing row (e.g., `scores_updated { week, updated_team_ids }`).

### 9.3 Client rules (unchanged doctrine, stronger wording)
- On join/reconnect: **fetch authoritative state via REST first**, render, *then* subscribe. Never depend on missed broadcasts. Each broadcast carries a monotonic `state_version` (from `drafts.updated_at`/sequence); a gap ⇒ refetch.
- Countdowns render from `current_deadline` (server timestamp) + a clock offset measured at subscribe (and corrected by the 15s heartbeat). Clients never own the clock.
- All writes go through Route Handlers/RPCs. The only direct client INSERT is `league_chat` (RLS-scoped, rate-limited).
- Subscription budget: **one socket per client, ≤ 3 channels** (current league, current draft, notifications). Unsubscribe on route change — connection leaks are the #1 cause of Realtime quota suspensions.
- **One live room per browser, per draft (v2.12 — the two-tabs guard; RULED by Chris 2026-08-17: *"The most recent one takes over and the others disconnect."*).** Desktop entry opens the room in a new browser tab (§16.1), so a user can trivially end up with two tabs of the same draft: two sockets, two `draft:<id>` subscriptions, two presence heartbeats under one presence key, and two `draft_touch` liveness loops — a per-user doubling of the fan-out this section's budget is written to bound, and a presence list that shows one manager twice. **The newest tab of a given draft holds the connection; older tabs release it** — they unsubscribe, stop the heartbeat, and render a plain "This draft is open in another tab" state with a **Use this tab instead** button that takes the connection back. Coordination is client-local (a `BroadcastChannel` keyed by draft id, `localStorage` as the fallback) and deliberately **per browser profile, not per user**: a manager legitimately watching on a laptop and a phone is two clients and is left alone. The guard is a **courtesy over a correctness boundary, never a substitute for one** — the server stays authoritative, so a stale tab that acts is refused by the same validators as anyone else (§8.1).

### 9.4 Capacity notes (see §22 for full model)
Supabase enforces per-plan quotas on concurrent connections, messages/sec, channel joins/sec, and channels per connection; overages bill per 1k peak connections and per 1M messages. The §22 capacity model shows the target load (hundreds of concurrent leagues) fits comfortably **only** with the Broadcast-from-DB design and per-league score batching; Postgres Changes would not. Escape hatches if growth exceeds managed quotas: Supabase Team plan custom limits → self-hosted Realtime (open source) → dedicated realtime provider for the socket layer only.
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
| **Membership** | Remove a manager with an explicit franchise outcome — **takeover** (successor inherits the franchise), **retire & succeed** (franchise sealed under its final manager; successor spun into the slot), or **vacate** (orphan/autopilot) — per §7.2.1; seat managers via seat-targeted invites; **act as any team in the league** — most commonly an orphaned one, but equally a still-seated manager who's gone inactive (logged with `acting_as_team_id`, §7.2.1 "Generalized Act as Manager"); promote/demote co-commissioners; convert a team to/from autopick/auto-manage. |
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

- **Captured per action:** `id`, `league_id`, `actor_id` (commish/co-commish), `action_type` (enum), `target_type` + `target_id` (e.g., matchup, team, trade, player, draft_pick, setting), `reason` (required, non-empty), `before` JSONB, `after` JSONB, `metadata` JSONB (e.g., week, affected_team_ids), `acting_as_team_id` (set when the commissioner acts on behalf of any team, most commonly an orphaned one or a still-seated inactive manager, §7.2.1), `created_at`. Optionally `is_reverted` + `reverted_by_action_id` for chained undo.
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
- **Schedule generation:** on draft completion (or when entering `in_season`), the schedule engine (§11.7) generates the season deterministically from `schedule_seed` — round-robin honoring divisions, plus `second_opponent` rows when enabled — stored as `matchups`. Commissioner-editable; **Remix** regenerates with preview + diff (§11.7).
- **Live scoring (v2.0 — server-materialized):** a matchup's team score = Σ fantasy points of that team's locked starters, computed via the §7.3.3 generic calculator (`src/lib/leagues/scoring/`, erratum v2.7.1) against the league's **scoring snapshot** (§7.3.3). Scores are computed **server-side** by the `score-league-week` worker (§22.2) from `player_stats` deltas and written to `matchups` / `team_week_results`, whose triggers broadcast one compact event per league (§9). Clients never subscribe to raw `player_stats`; the matchup view refetches box-score lines on `scores_updated`. Matchup view reuses Live Mode patterns (Now Playing / Done / Up Next).
- **Swap resolution:** if a team armed a Swap spot (§7.3.2) and it triggers, the effective starter for that slot becomes the swap-in player (pre-game inactive) or the greater-of result (in-game injury); live scoring and finalization use the resolved slot.
- **Finalization:** after the week's games + the stat-correction window (configurable, default **Thursday 06:00 ET** — §23.4), the matchup is marked `final`, W/L/T (plus median/second-opponent results, §11.7) written to `team_week_results`, standings updated, and `league_weeks.status → final`. Until then, completed matchups display `final (pending corrections)`. A `final` matchup is only changed via a commissioner override (§10).
- **Stat corrections:** when the stats pipeline applies an official correction within the window, affected non-final matchups recompute automatically; the league sees a system note. *(Avoid the ESPN double-credit trap: never let a manual override and an automatic correction both apply — overrides set an absolute value or are tagged to suppress auto-recompute for that cell.)*

### 11.5 Standings & playoffs
- **Standings:** computed from final matchups; ordered by the tiebreaker chain (§7.3.7). Live "projected standings" shown during a week.
- **Divisions:** if 2, standings shown per division + overall; seeding rules configurable (division winners seeded first, optional).
- **Playoffs:** when `playoff_start_week` arrives, generate the bracket from seeds (byes for top seeds when bracket > `playoff_teams`); `playoff_reseed` controls per-round reseeding; optional consolation + third-place. Bracket is commissioner-editable. Champion recorded on `complete`.

### 11.6 History Mode (carry-over from existing PRD §F9)
- Preserve the existing **History Mode** concept (per-season records, H2H history between any two teams, avg points/week, win %). In this model it's simply derived from the persisted `matchups`/`league_rosters`/standings for completed seasons; expose it on a league History tab. (The original $5/yr monetization is a product decision — see Open Questions; the data is retained regardless so it can be unlocked retroactively.)
- **v2.1 — history is franchise-first with per-stint attribution** (§7.2.1/§12.22): a franchise page shows its manager timeline and record splits per stint; a retired franchise stays permanently visible under its final manager; a successor franchise's book opens at its founding week. A user's profile aggregates their stints across leagues into a "managerial record".

### 11.7 Schedule engine, remix & extra weekly games (NEW v2.0)

The v1.x spec generated a round-robin and let the commissioner hand-edit it. v2.0 makes scheduling a first-class, deterministic engine with a **Remix** action (the "reshuffle until we like it" flow), plus the two extra-game modes leagues increasingly expect.

**Generation (deterministic, seeded).**
- Algorithm: **circle-method round-robin** over `team_count` teams. A seeded PRNG (`schedule_seed`, stored on `leagues.settings`) permutes the team order before generation, so the same seed always reproduces the same schedule (auditable, previewable, diffable).
- `regular_season_weeks > team_count − 1` ⇒ the rotation cycles; a repeat pairing is always ≥ 3 weeks after the first meeting, and repeat counts are balanced (max spread of 1 across pairings).
- **Divisions (if 2):** intra-division pairings are scheduled twice before any pairing repeats cross-division (classic "play your division 2×"), weeks permitting; the validator reports if the week count can't satisfy it.
- Validation invariants: every team appears exactly once per week (v1: even counts, no byes); no self-matchups; `UNIQUE(league_id, season, week, home_team_id)` **and** `UNIQUE(league_id, season, week, away_team_id)` both hold; home/away alternates within a pairing.

**Remix (commissioner action).**
- **"Remix schedule"** regenerates with a fresh seed and shows a **preview diff** ("Week 3: you now play Team D instead of Team B…") before Confirm. Confirm replaces all `scheduled` matchups atomically and **auto-posts a system message to league chat** (Sleeper posts on randomize; we match, non-disableable).
- Allowed freely until the **first NFL kickoff of league Week 1**. After that, Remix and any matchup edit become commissioner **overrides** (reason + audit entry per §10) and only `scheduled` future weeks may change — `live`/`final` weeks never regenerate.
- Manual per-matchup editing (drag Team A ↔ Team C for Week 7) stays available in the same tool, same audit rules.

**Extra weekly games (regular season only; both off by default).**
- `median_game` (Sleeper-style "Extra Game vs League Median"): each week every team also gets a W/L/T vs the **league median score** — the average of the two middle team scores that week (scoring exactly the median = tie). Doubles games played; standings and Win % include it.
- `second_opponent` (Yahoo Commissioner Plus-style): each team gets a second H2H matchup vs a different opponent each week, generated as a per-week derangement of the primary schedule (never your primary opponent, never yourself). Stackable with `median_game` (up to 3 results/week).
- Both are computed at finalization into `team_week_results` (§12.18) — they are results, not extra `matchups` rows, except `second_opponent` which *does* materialize as `matchups.round_type = 'secondary'` rows so the UI can render it like any matchup.
- Playoff seeding/tiebreakers use the combined record; Points For is counted **once** per week regardless of extra games.

**Scoring-format setting.** `schedule_mode = 'h2h'` (default) or `'total_points'`. Total-points leagues generate no matchups: standings order by cumulative Points For, "playoffs" reduce to a final-week points race unless `playoff_teams > 0` is explicitly set with H2H brackets from points-seeding. (This closes the "head-to-head vs total scoring" requirement as a first-class mode rather than the v1.x `playoff_teams = 0` workaround.)

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
> **v2.0 hardening:** every `SECURITY DEFINER` function (helpers, all RPCs, broadcast triggers) must `SET search_path = ''` (schema-qualify all references) and re-validate authorization **inside the function body** (`is_league_commish()` etc.) — the Route Handler check is UX, the in-function check is security. `REVOKE EXECUTE ... FROM anon` on all league RPCs.

### 12.1 `leagues` (ALTER existing)
```sql
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'setup',
    -- setup | scheduled | drafting | in_season | playoffs | complete
  ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'redraft',
  ADD COLUMN IF NOT EXISTS team_count INTEGER NOT NULL DEFAULT 12
    CHECK (team_count IN (8,10,12,14,16)),  -- v1; widen to 18/20 + odd in v1.1 (OQ 12)
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
    -- v2.0 additions: schedule_mode, median_game, second_opponent, schedule_seed,
    -- player_game_lock, bench_lock, fa_hold_hours, trade_lock_behavior, stat_correction_window, flags
  ADD COLUMN IF NOT EXISTS scoring_rules_snapshot JSONB,
    -- v2.0: frozen copy of scoring_systems.rules taken at draft start (§7.3.3); all scoring reads this
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
-- v2.7.1 gap fix (C9 in tasks-M1-league-foundation.md): 001's roster_settings DEFAULT is the legacy
-- flat shape; the M1 migration replaces it with the §7.3.2 preset-table Default counts rendered in
-- the canonical starting_slots[] shape (no leagues rows exist — verified at reset, prod check noted
-- in the 040 PR):
-- ALTER TABLE leagues ALTER COLUMN roster_settings SET DEFAULT '<§7.3.2 canonical 12-team default>';
-- NOTE: existing columns reused: id, owner_id (the commissioner), name, description,
--   max_teams (kept in sync with team_count), scoring_system_id, roster_settings (slots),
--   invite_code, is_active, season, created_at, updated_at.
```
RLS already exists ("viewable by members", "owners can manage"); **replace** the member-check policy to use `league_members` (the old policy keyed off `teams.league_id`), and **drop** the owner write policy (v2.8.2 — supersedes the earlier "keep" instruction, which predates the protected columns this section adds: `scoring_rules_snapshot`, `status`, `settings` must never be client-writable):
```sql
DROP POLICY IF EXISTS "Leagues are viewable by members" ON leagues;
CREATE POLICY "Leagues viewable by members"
  ON leagues FOR SELECT
  USING (is_league_member(id) OR owner_id = auth.uid());
-- v2.8.2 (Q8 ruling): once created, league state is server-authoritative — NO
-- direct client DML. Drop "League owners can manage" (FOR ALL); owner SELECT
-- rides the policy above. Creation = create_league RPC; settings/lifecycle =
-- their RPCs; deletion = the §15.1 soft delete. Co-commish management via
-- RPCs (SECURITY DEFINER) as before.
DROP POLICY IF EXISTS "League owners can manage" ON leagues;
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
-- v2.8.2 (Q8 ruling — replaces the earlier "Commish manages members" FOR ALL):
-- seating (team_id), roles, and real-user membership move ONLY through the
-- SECURITY DEFINER RPCs, which write team_managers stints in the same
-- transaction (v2.1 note below).
-- v2.8.8 (migration 063, L.A1.15): the two placeholder carve-out policies
-- v2.8.2 kept are DROPPED — league_members has NO client write policy at all,
-- SELECT only. A placeholder seat IS a franchise (§7.2: "a teams row owned by
-- the commissioner, flagged is_placeholder"), so it carries team_id and counts
-- against team_count; the carve-outs required team_id IS NULL — a seat with no
-- franchise, invisible to every capacity check and unreachable by
-- assign_manager. Seats are created by add_placeholder_seat and reopened by
-- remove_manager(vacate) / leave_league, all of which keep the franchise, the
-- capacity count and the stint history coherent in one transaction.
CREATE INDEX idx_league_members_league ON league_members(league_id);
CREATE INDEX idx_league_members_user ON league_members(user_id);
CREATE INDEX idx_league_members_team ON league_members(team_id);  -- v2.8.2: FK index (teams ON DELETE SET NULL)
```
> **v2.1:** `user_id`/`team_id` here are a **current-state cache** for fast lookups; the historical truth of who managed which franchise when is `team_managers` (§12.22). Update both inside the same RPC transaction.
>
> **v2.8.7:** "seeded from `leagues.faab_budget`" means balances **track the budget until the draft starts**: a pre-draft `faab_budget` change re-seeds every seat's `faab_balance` to the new budget in the same transaction (`update_league_settings`, migration 061 — settings are only writable in `setup`/`scheduled` per the §7.3 header, and nothing spends FAAB before `in_season`, so pre-draft balances carry no history; rationale PROGRESS D70(4), folded in per R80).

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
  deadline_remaining_ms INTEGER,               -- v2.0: remaining clock persisted on pause (§8.7)
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  budget_adjustments JSONB NOT NULL DEFAULT '{}'   -- v2.10.2 (D127): auction commissioner budget edits — team_id → integer delta; budgets stay DERIVED (never stored counters), this map is the one stored input
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
  action_id UUID,                                   -- client-generated; dedupes retries (idempotency); NULL for system rows (v2.10.2)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  voided_at TIMESTAMPTZ                             -- v2.12.2 (D162), extended v2.12.4 (R379): this bid's nomination was voided, or its whole RUN was
);
-- v2.12.2 erratum (§8.7's "open bids voided" had no schema representation —
-- tasks-M3 R363/D162; migration 087, task L.C1.5). `voided_at IS NOT NULL`
-- means: this row no longer belongs to the live-or-future nomination at its
-- `nomination_seq`. That is exactly the THREE cases in which a sequence number
-- becomes ambiguous (v2.12.2 printed two; (c) was added by v2.12.4 and is the
-- widest of them) — (a) the sequence is CLEARED WITHOUT AN AWARD
-- (`draft_cancel_nomination`, which per §8.7 does NOT consume the number, and
-- `draft_end`'s un-awarded close), (b) the sequence is REWOUND ONTO
-- (`draft_undo`), and — **v2.12.4 (R379)** — (c) THE RUN ENDS AND THE
-- NUMBERING RESTARTS (`draft_reset` rewinds `current_pick_number` to 1 and
-- §8.5's start re-issues every number from there, so the WHOLE of the previous
-- run's history sits at numbers the next run will use again). (c) is the only
-- one that makes a sequence ambiguous ACROSS runs rather than within one, which
-- is why a reader that must see voided rows — the undo's on-clock recovery —
-- additionally scopes by `drafts.started_at`. A REVERSED pick is deliberately
-- not in that list: it consumes no sequence number, so its reversal stays
-- recorded on `draft_picks.is_undone`. The table remains APPEND-ONLY at the client
-- boundary — no UPDATE or DELETE policy exists for any role, and the stamp is
-- written only by SECURITY DEFINER verbs — so the D131(2) ruling is unchanged;
-- what changes is that "voided" now denotes something a reader can filter on,
-- which is what lets the award's attribution lookup be correct by its WHERE
-- clause instead of by an ORDER BY.
-- v2.10.2 (C39 erratum): action_id is NULLABLE and the idempotency unique is
-- PARTIAL — system rows (the tick's opening bid on a system nomination,
-- D129(2)/D130) have no client action; the 065 uniq_draft_action pattern:
CREATE UNIQUE INDEX uniq_draft_bid_action
  ON draft_bids(draft_id, action_id) WHERE action_id IS NOT NULL;
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
  round_type TEXT DEFAULT 'regular',               -- regular | playoff | consolation | third_place | secondary (v2.0 §11.7)
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
  UNIQUE(league_id, season, week, home_team_id),
  CHECK (away_team_id IS NULL OR away_team_id <> home_team_id)
);
-- v2.0: a team appears at most once per week on either side (per round_type):
CREATE UNIQUE INDEX uniq_matchup_away_per_week
  ON matchups(league_id, season, week, round_type, away_team_id) WHERE away_team_id IS NOT NULL;
CREATE UNIQUE INDEX uniq_matchup_home_per_week
  ON matchups(league_id, season, week, round_type, home_team_id);
-- (the plain UNIQUE above is superseded by the round_type-aware pair; keep both or drop the plain one in the migration)
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
  claim_order INTEGER DEFAULT 1,                     -- v2.0: this team's own ranking for cascading claims (1 = try first)
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
> Because there is **no** UPDATE or DELETE policy, even a commissioner cannot alter or remove an entry — Postgres denies it. Every override RPC inserts here in the same transaction as the state change (a state change without its log entry is impossible). Add `matchups.override_action_id` / `transactions.related_action_id` FKs → this table (added in Phase E, after this table exists). **Caveat:** RLS does not restrict Supabase's `service_role`/admin, which bypasses RLS — so the optional hash chain (§10.3) is the real defense against privileged writes, and a DB trigger on overridable tables (requiring a matching log row) is a recommended backstop so no future code path can change state without logging. **v2.0 makes the backstop concrete:** override RPCs set a transaction-local GUC after inserting the log row; a `BEFORE UPDATE` trigger on overridable columns refuses commissioner-path writes without it:
```sql
-- inside every override RPC, same transaction as the state change:
PERFORM set_config('app.commish_action_id', v_action_id::text, true);
-- trigger sketch on e.g. matchups (guards is_overridden / result / score edits):
IF (NEW.is_overridden AND COALESCE(current_setting('app.commish_action_id', true), '') = '')
THEN RAISE EXCEPTION 'override without audit entry'; END IF;
```

### 12.13 `team_lineups` (extend existing) & `league_chat` (extend existing)
```sql
-- team_lineups already: (team_id, season, week, starters JSONB, bench JSONB, total_points, set_at)
ALTER TABLE team_lineups
  ADD COLUMN IF NOT EXISTS slot_map JSONB,           -- v2.0 FIX: { "<slot_key>:<index>": "<player_id>" }, e.g. "rb:0","rb:1" — slots with count>1 expand to indexed instances; canonical everywhere (lineup editor, legality checks, swaps, overrides)
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edited_by_commish BOOLEAN DEFAULT FALSE;

-- league_chat already: (league_id, user_id, message, created_at). Add a context to support draft chat + system posts.
ALTER TABLE league_chat
  ADD COLUMN IF NOT EXISTS context TEXT DEFAULT 'league',   -- 'league' | 'draft:<draft_id>'
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE; -- system posts for commissioner actions (non-deletable)
```

### 12.14 Realtime broadcast triggers *(rewritten v2.8.15 — D89 erratum)*
*(v1.x printed a `supabase_realtime` publication ALTER here "so Postgres Changes broadcast" — text §9's v2.0 transport rule supersedes: clients never use Postgres Changes, `realtime.broadcast_changes()`/`realtime.send()` write to `realtime.messages` and need no publication membership, and adding the tables would only re-enable the anti-pattern the §8.4 checklist bans. The publication ALTER is **not executed** anywhere.)*

This section is the **Broadcast-from-DB trigger inventory** (the §9.2 pattern; every payload column-selected, every channel private):

| Table | Events | Topic | Ships |
|---|---|---|---|
| `drafts` | UPDATE | `draft:<id>` | migration 070 (M2) |
| `draft_picks` | INSERT/UPDATE | `draft:<draft_id>` | migration 070 (M2) |
| `league_chat` | INSERT | `context` when `draft:%`, else `league:<league_id>` | migration 070 (M2) |
| `leagues` | UPDATE OF status, name, avatar_url | `league:<id>` | migration 070 (M2) |
| `league_rosters` | at table creation | `league:<league_id>` | migration 072 (M2, L.B1.7(3b)) |
| `draft_bids` | with the auction engine | `draft:<draft_id>` | M3 |
| `matchups`, `team_week_results`, `transactions`, `commissioner_actions`, `lineup_swaps` + the F42 set (`league_members`, `team_managers`, `teams`, `league_invites`, `league_weeks`, `league_lists`) | with their first subscriber | `league:<league_id>` | M4+ (PROGRESS F42) |

**Never broadcast:** `draft_queues`, `waiver_claims` (§9.2 sensitive — owners poll/refetch), `draft_liveness` (D102 — Presence owns who's-online). The §9.1 tick heartbeat (`event: tick`, server-now + deadline) rides `realtime.send()` from `draft_tick()` (migration 068 ARM 3). Channel authorization = the §9.2 `realtime.messages` policies (migration 070): member SELECT per topic family + presence-only INSERT (client broadcast deliberately closed — a member must not be able to forge a server-shaped event).

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
> **Shared-private lists:** the existing `lists` RLS allows public read + owner read. To let members open a list that is **shared but private** in the draft room, add a SELECT policy on `lists` permitting read when a `league_lists` row links it to a league the viewer belongs to with `shared_with_league = TRUE`. Public lists are already readable, so this only matters for private shares. *(Erratum v2.8.12, shipped as migration 067: two mechanical completions — (1) a companion `list_players` SELECT policy under the same predicate, plus `deleted_at IS NULL` on both new policies mirroring 001's public arm ("opening" a shared list means reading its rows, and the existing `list_players` policy re-states list visibility inline, so it does not follow this new policy automatically); (2) the `owner_id` comment above ("matches lists.owner_id") is ENFORCED by a composite FK `(list_id, owner_id) → lists(id, owner_id)` — without it, a member could attach and force-share another user's private list. PROGRESS D106.)*

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

### 12.17 `league_weeks` (per-league week state) — NEW v2.0
One row per (league, week): finalization state, median score, waiver bookkeeping. Gives crons an idempotent anchor and the UI a single source for "is this week final?".
```sql
CREATE TABLE league_weeks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming',   -- upcoming | live | correction_window | final
  median_score NUMERIC(8,2),                 -- set at finalization when median_game is on
  waivers_processed_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  reopened_by_action_id UUID,                -- commissioner reopen (audited)
  UNIQUE(league_id, season, week)
);
ALTER TABLE league_weeks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "League weeks viewable by members"
  ON league_weeks FOR SELECT USING (is_league_member(league_id));
```

### 12.18 `team_week_results` (materialized weekly results & standings source) — NEW v2.0
Standings were previously derived by scanning `matchups` with tiebreaker logic per request. At hundreds of leagues that's wasteful and makes median/second-opponent games awkward. This table is written by `score-league-week` (live, provisional) and `finalize-matchups` (final), and standings become a single indexed scan.
```sql
CREATE TABLE team_week_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  points NUMERIC(8,2) NOT NULL DEFAULT 0,        -- counted once/week for Points For
  opponent_team_id UUID REFERENCES teams(id),
  h2h_result TEXT,                                -- win | loss | tie | bye | NULL(pending)
  median_result TEXT,                             -- win | loss | tie | NULL (median_game off/pending)
  second_opponent_team_id UUID REFERENCES teams(id),
  second_result TEXT,                             -- win | loss | tie | NULL
  is_final BOOLEAN DEFAULT FALSE,
  UNIQUE(league_id, team_id, season, week)
);
ALTER TABLE team_week_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Results viewable by members"
  ON team_week_results FOR SELECT USING (is_league_member(league_id));
CREATE INDEX idx_twr_league_season ON team_week_results(league_id, season, week);
```
> Precedence: `matchups` remains the pairing + score + override source of truth; `team_week_results` is derived and always rebuildable from it (a `rebuild_team_week_results(league_id, week)` RPC exists for corrections/overrides).

### 12.19 `league_player_pool` (per-league waiver/lock state of unowned players) — NEW v2.0
The v1.x design inferred waiver state from `transactions` timestamps at read time — workable, but the waiver processor and the game-day lock rules (§7.3.4) need authoritative, indexable state. Maintained by the add/drop/waiver/trade RPCs and the `lineup-lock` / `process-waivers` jobs.
```sql
CREATE TABLE league_player_pool (
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  player_id TEXT REFERENCES players(id) NOT NULL,
  state TEXT NOT NULL DEFAULT 'free_agent',   -- free_agent | on_waivers | rostered | locked_in_game
  waivers_until TIMESTAMPTZ,                  -- when the player clears (NULL unless on_waivers)
  locked_until TIMESTAMPTZ,                   -- game-day add lock (player_game_lock=on): kickoff → week clear
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (league_id, player_id)
);
ALTER TABLE league_player_pool ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Pool viewable by members"
  ON league_player_pool FOR SELECT USING (is_league_member(league_id));
CREATE INDEX idx_pool_waivers ON league_player_pool(league_id, waivers_until)
  WHERE state = 'on_waivers';
```
> Rows are created lazily (a player with no row = `free_agent` if unowned). `rostered` rows mirror `league_rosters` for one-lookup legality checks; a nightly reconciliation job asserts the mirror matches.

### 12.20 `nfl_weeks` (global NFL calendar) — NEW v2.0
Week boundaries stop being implicit. All week-scoped jobs key off this table; kickoff-derived locks always read `nfl_games.kickoff_at` **at evaluation time** (never cached) so NFL flex-scheduling and postponements are safe.
```sql
CREATE TABLE nfl_weeks (
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,                      -- 1..18
  starts_at TIMESTAMPTZ NOT NULL,             -- typically Wed 00:00 ET
  first_kickoff_at TIMESTAMPTZ,               -- updated from nfl_games (TNF)
  last_game_ends_at TIMESTAMPTZ,              -- updated as games finish (MNF)
  correction_window_ends_at TIMESTAMPTZ,      -- default: Thu 06:00 ET after the week (see §23.4)
  PRIMARY KEY (season, week)
);
-- world-readable reference data; no RLS-sensitive content
```

### 12.21 `stat_correction_events` — NEW v2.0
Detected by the ingestion diff (§23.4); drives auto-recompute and the league-facing "Stat Corrections" view (filtered to that league's starters, Sleeper-style).
```sql
CREATE TABLE stat_correction_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  player_id TEXT REFERENCES players(id) NOT NULL,
  stat_key TEXT NOT NULL,
  old_value NUMERIC,
  new_value NUMERIC,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  applied_at TIMESTAMPTZ                      -- when league recompute fan-out completed
);
CREATE INDEX idx_stat_corrections_week ON stat_correction_events(season, week);
```

---

### 12.22 `team_managers` (manager stints) + franchise lifecycle columns — NEW v2.1
The historical truth of §7.2.1. One row per stint; a team's current manager = the row with `ended_at IS NULL`.
```sql
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',      -- active | orphaned | retired
  ADD COLUMN IF NOT EXISTS retired_at_week INTEGER,                     -- league week the franchise was sealed
  ADD COLUMN IF NOT EXISTS successor_team_id UUID REFERENCES teams(id); -- set on the RETIRED team → its successor
-- v2.8.2 integrity: the status enum is CHECK-enforced, and a team can never
-- succeed itself; longer succession cycles are rejected in-body by
-- retire_franchise (the only writer of successor_team_id).
ALTER TABLE teams
  ADD CONSTRAINT teams_status_valid CHECK (status IN ('active','orphaned','retired')),
  ADD CONSTRAINT teams_successor_not_self CHECK (successor_team_id IS NULL OR successor_team_id <> id);
-- v2.7.1 gap fixes (M1 Architect survey — the deployed 001 schema blocks §7.2 as written):
ALTER TABLE teams ALTER COLUMN list_id DROP NOT NULL;  -- league franchises carry no backing list; standalone team-lists unaffected
-- Replace 001's client-write policy: "Users can manage own teams" becomes owner-manage scoped to
-- league_id IS NULL (legacy standalone teams). League teams are written ONLY via SECURITY DEFINER
-- RPCs (server-authoritative, §8.1). World-readable SELECT stays (public league summary, §17).

CREATE TABLE team_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL DEFAULT 'manager',        -- manager (co_manager reserved post-v1)
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_week INTEGER,                        -- league-week granularity for history splits (NULL preseason)
  ended_at TIMESTAMPTZ,
  ended_week INTEGER,
  end_reason TEXT,                             -- kicked | left | seat_retired | replaced
  ended_by UUID REFERENCES profiles(id),       -- commissioner, or self
  UNIQUE (team_id, user_id, started_at)
);
CREATE UNIQUE INDEX one_open_stint_per_team ON team_managers(team_id) WHERE ended_at IS NULL;
CREATE INDEX idx_team_managers_user ON team_managers(user_id);
-- v2.8.2: FK indexes (the SELECT policy filters on league_id; the partial
-- unique index above only covers open stints, so closed-stint history reads
-- and the teams ON DELETE CASCADE check need the full team_id index).
CREATE INDEX idx_team_managers_league ON team_managers(league_id);
CREATE INDEX idx_team_managers_team ON team_managers(team_id);
ALTER TABLE team_managers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Stints viewable by league members"
  ON team_managers FOR SELECT USING (is_league_member(league_id));
-- writes only via SECURITY DEFINER RPCs: assign_manager / remove_manager(mode) / retire_franchise
```
> Claiming a placeholder seat opens the user's first stint. Backfill migration: open a stint for every currently seated `league_members` row so history never has a gap. Write stints from day one — retrofitting them later means guessing at dates.

### 12.23 `league_invites` (seat-targeted invites + custom slug) — NEW v2.1
```sql
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS invite_slug CITEXT UNIQUE;  -- custom share URL; NULL → random invite_code

CREATE TABLE league_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL,
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  target_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,  -- NULL = general league invite
  invited_username CITEXT,                                     -- optional: restrict claim to this handle
  invited_email CITEXT,                                        -- optional: restrict claim to this login email (never league-visible)
  created_by UUID REFERENCES profiles(id) NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,                         -- general links may set higher
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '14 days',
  revoked_at TIMESTAMPTZ,
  claimed_by UUID REFERENCES profiles(id),
  claimed_at TIMESTAMPTZ
);
CREATE INDEX idx_league_invites_league ON league_invites(league_id);
ALTER TABLE league_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Invites viewable by commish"
  ON league_invites FOR SELECT USING (is_league_commish(league_id));
-- claim path = SECURITY DEFINER RPC keyed by token; pre-auth it exposes only league name + team label + the inviter's handle for the claim page (v2.7.1: aligned to §16.2/§16.4/§16.5.2, which specify the inviter as growth-loop design; this comment previously said two fields. v2.9: the inviter can only be a handle — no name is stored for a person, so get_join_preview's COALESCE resolves to `username` in every case)
-- v2.7.1 gap fix (D46, tasks-M1 C18): §7.2 requires every send recorded; the DDL above additionally carries
--   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- initial send for email invites
--   last_sent_at TIMESTAMPTZ                        -- updated on re-send
```

### 12.24 `draft_dnd_marks` (Do-Not-Draft labels — NEW v2.10)
```sql
CREATE TABLE draft_dnd_marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES drafts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  player_id TEXT REFERENCES players(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(draft_id, user_id, player_id)
);
ALTER TABLE draft_dnd_marks ENABLE ROW LEVEL SECURITY;
-- Own rows only, read and write (the draft_queues client-write precedent — §12.6):
CREATE POLICY "Own DND marks" ON draft_dnd_marks FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX idx_draft_dnd_user ON draft_dnd_marks(draft_id, user_id);
```
Per-user, per-draft marks ("Do Not Draft") set from the auction player table (§16.2) — private prep data, **never broadcast** (§9.2's blind-data rule; the `draft_queues` class). Marks are scoped to a draft: a mock's marks never pollute the real draft's, and a reset draft keeps them (they are prep, not draft state). **Display-only, ruled (OQ 20, 2026-08-16): the ENGINE NEVER READS THIS TABLE** — autopick, the Targets fallback, and system nominations ignore marks entirely; the skip behavior was offered and declined. The table exists purely so the UI label persists across sessions/devices; no RPC, trigger, or worker may join against it.

### 12.25 `scoring_systems` (extend existing) — league custom scoring (NEW v2.11)

**No new columns.** The §7.3.3.1 editor reuses the existing table and the existing `leagues.scoring_system_id` reference; a custom system is an ordinary row (`owner_id` = commissioner, `is_template = FALSE`) whose `rules` may be the format-2 envelope. The D59 doctrine is untouched: templates stay ownerless and client-immutable under the `scoring_systems_template_ownerless` CHECK.

- **Additive SELECT policy — league members read a league-referenced system:** members must see their league's custom rules pre-draft (post-draft they read the snapshot). Add alongside 001's owner policy and 058's template read:
```sql
CREATE POLICY "League members read league scoring" ON scoring_systems FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM leagues l
    JOIN league_members lm ON lm.league_id = l.id AND lm.user_id = (SELECT auth.uid())
    WHERE l.scoring_system_id = scoring_systems.id AND l.deleted_at IS NULL
  ));
```
- **Writes are server-authoritative:** the fork (template → custom row + `scoring_system_id` repoint) and every rules edit go through SECURITY DEFINER RPCs (`search_path=''`, the §12 house pattern; commissioner-only, league in `setup`/`scheduled` per the §7.3 header) that run the §7.3.3.1 guardrail validation — 001's owner FOR ALL would let a commissioner hand-write an arbitrary doc, so the **snapshot-time re-validation in `draft_start` is the integrity backstop** (an invalid doc can never reach `scoring_rules_snapshot`; §7.3.8). Exact RPC names/migration number are the follow-up breakdown's to assign.
- **Orphan hygiene:** re-picking a plain template (or re-forking) detaches the previous custom row. Detached rows are **left in place** for the cohort: `scoring_systems` has no `deleted_at`, a fork-created row is not distinguishable from a personal one (no marker column — "no new columns" above), and deleting a row we cannot prove fork-created risks user data; the member SELECT policy stops matching the moment it is unreferenced, so the only cost is clutter in the owner's personal-systems list. If cohort feedback cares, a marker column is a v-next decision.

## 13. Transactions — Waivers, FAAB, Trades & Free Agency

### 13.1 Add / drop & free agency
- Managers add an unowned player (FCFS after waivers clear) and drop one to stay within `roster_size`. Validates exclusivity (`league_rosters` unique), roster legality, lock state, and acquisition caps. Writes a `transactions` row (`type='add_drop'`) and updates `league_rosters`.
- Dropped players enter waivers for `waiver_period_hours` (unless `none_fcfs`); `league_player_pool` (§12.19) tracks `on_waivers`/`waivers_until` authoritatively.
- **Game-day locks (v2.0, default strict):** with `player_game_lock` on, a player **cannot be added or dropped from their kickoff until the week's correction window closes** — no in-game stat-sniping pickups, no dropping a player mid-game. With `bench_lock` on, waiver claims whose drop already played fail at processing (E32–E34). Both settings off reproduce incumbent-lax behavior; the strict pair is the FieldScout default per the product requirement.

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
| `draft-tick` | every ~5s **while any draft is `live`** (self-gating; no-op otherwise) | Enforce `current_deadline`: autopick (snake/linear) or close the bid / advance nomination (auction); set next deadline; broadcast via row update. Self-reschedules immediately after each user action for tight timing. **v2.0:** claims due drafts with `FOR UPDATE SKIP LOCKED` in batches so one cron entry scales to hundreds of concurrent drafts (§22.3). *(Erratum v2.8.13: implemented as the in-database `draft_tick()` RPC scheduled by pg_cron directly — no Edge Function; timeout grace per the D102 contract (§8.5.5 erratum) and the D94 auto-start scan ride the same tick. See the §8.2 erratum/D87.)* |
| `process-waivers` | per-league cadence (default Wed 3:00am local) | Resolve pending `waiver_claims` atomically (§13.2), honoring `claim_order` cascading and `bench_lock`. **v2.0:** one cron scans `leagues.waiver_next_run_at`, enqueues due leagues to pgmq, workers drain with SKIP LOCKED (§22.3). |
| `finalize-matchups` | after the week + `stat_correction_window` (default **Thu 06:00 ET**, §23.4) | Mark matchups `final`; write W/L/T + median/second-opponent results to `team_week_results` (§12.18); set `league_weeks.status='final'`; update standings; respects overrides (never recompute an overridden cell). |
| `trade-review-expiry` | every 15 min | Auto-resolve trades whose review window elapsed. |
| `lineup-lock` | every 1 min on game days | Lock slots per `lineup_lock`; arm swaps at lock; optional `auto_sub_inactives` (§11.3). **v2.0:** derives every lock from `nfl_games.kickoff_at` at run time (flex-schedule-safe, §23.3) and maintains `league_player_pool.locked_until` for `player_game_lock`. |
| `process-swaps` | game windows (rides `sync-live-stats`, ~30s) | Fire armed **Swap spots** (§7.3.2): pre-game when the *out* player is inactive at kickoff, in-game when ruled out mid-game; set `lineup_swaps` status, credit the slot per the resolution rule, write a `transactions` (`auto_swap`) row, broadcast to the live matchup. |
| `score-league-week` | every 5–10s in game windows (v2.0) | Drains the `score_fanout` pgmq queue of changed player-stat deltas, maps them to affected leagues via `league_rosters(player_id)`, batch-recomputes matchup scores + `team_week_results` per league, one broadcast per league per batch (§22.2). |
| `sync-stat-corrections` | hourly Tue–Thu after a week (v2.0) | Diff post-final provider stats → `stat_correction_events` → recompute affected non-overridden cells → system notes (§23.4). Late (post-window) corrections are flagged for commissioner apply, not auto-applied. |
| `league-week-advance` | hourly (v2.0) | Advance `league_weeks.status` on `nfl_weeks` boundaries; open the next week; never infer "current week" from wall-clock math elsewhere (§23.3). |
| live stats ingestion | reuse existing `sync-live-stats` (20–30s in game windows) | Polls the provider, idempotent diff-aware upserts to `player_stats`, enqueues real deltas to `score_fanout`. Clients never subscribe to raw `player_stats` (§9.1). |

**Authoritative-clock principle:** the draft is correct even if all clients are offline because `draft-tick` enforces deadlines server-side. All money/exclusivity-affecting jobs run inside transactions using the same RPC validators as user actions.

---

## 15. API Surface

All mutations are Route Handlers (`app/api/...`, kebab-case) per `CLAUDE.md`; Zod-validate every input. Concurrency-critical draft/transaction logic lives in Postgres **RPCs** (`SECURITY DEFINER`) the handlers call inside a transaction, so the same validation runs whether triggered by a user or a cron job.

### 15.1 League & membership
```
POST   /api/leagues                         create league (free — v2.8; no Pro gate)
GET    /api/leagues                         my leagues
GET    /api/leagues/[id]                    league detail (members, settings, status)
PATCH  /api/leagues/[id]                    update settings (commish; structural changes post-draft are overrides)
DELETE /api/leagues/[id]                    soft delete (commish)
POST   /api/leagues/[id]/invite             create/refresh invite code; send invites
POST   /api/leagues/join                    join via invite code (free)
POST   /api/leagues/[id]/members            add placeholder seat (commish)
PATCH  /api/leagues/[id]/members/[mid]      role change / toggle autodraft (commish)
DELETE /api/leagues/[id]/members/[mid]      remove manager — body { mode: 'takeover'|'retire'|'vacate', successor_user_id?, reason } (§7.2.1; audited)
POST   /api/leagues/[id]/teams/[tid]/assign-manager  seat a user on a franchise (opens stint; audited)
POST   /api/leagues/[id]/invites            create seat-targeted or general invite (commish)
DELETE /api/leagues/[id]/invites/[iid]      revoke an invite (commish)
POST   /api/invites/claim                   claim by token (sign-up/sign-in → seated; opens stint)
PATCH  /api/leagues/[id]/slug               set/clear the custom invite slug (commish)
```

### 15.2 Draft
```
POST   /api/leagues/[id]/draft              create/schedule draft from settings (commish)
POST   /api/leagues/[id]/mock-drafts        start a solo mock from league settings (any member; §8.8)
GET    /api/leagues/[id]/mock-drafts        my mocks in this league (active + recaps)
DELETE /api/leagues/[id]/mock-drafts/[did]  abandon/delete a mock (owner)
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
POST   /api/leagues/[id]/draft/clock        rpc draft_set_clock (E15)   -- erratum v2.8.17
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
POST   /api/leagues/[id]/schedule/remix     regenerate schedule w/ new seed → preview  (v2.0, commish; §11.7)
POST   /api/leagues/[id]/schedule/confirm   apply a previewed remix (atomic; system chat post)
GET    /api/leagues/[id]/corrections?week=  stat corrections filtered to this league's starters (v2.0, §23.4)
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

Follows `docs/06-DESIGN-SYSTEM.md` (dark, Spotify-green accent, Inter, dense player rows, tier colors) and `docs/07-NAVIGATION-ARCHITECTURE.md` (v2.8: the Leagues nav item is no longer Pro-gated — creation and joining are free). Mobile-first; drag-and-drop must work on touch (reuse `@dnd-kit`).

### 16.1 Routes (App Router)
```
src/app/(app)/leagues/page.tsx                      My Leagues (list + Create)
src/app/(app)/leagues/new/page.tsx                  Create wizard (settings §7.3)
src/app/(app)/leagues/[id]/page.tsx                 League home (matchup of the week, standings peek, activity)
src/app/(app)/leagues/[id]/settings/page.tsx        Settings (commish)
src/app/(app)/leagues/[id]/draft/page.tsx           DRAFT ROOM (live) — FULL-SCREEN, CHROME-FREE (v2.12): no left nav, no right context rail, no app header
src/app/(app)/leagues/[id]/team/[teamId]/page.tsx   Team/roster + weekly lineup
src/app/(app)/leagues/[id]/matchup/[mid]/page.tsx   Matchup detail (live, Live Mode style)
src/app/(app)/leagues/[id]/standings/page.tsx       Standings + playoff bracket
src/app/(app)/leagues/[id]/players/page.tsx         League players / free agents / waivers
src/app/(app)/leagues/[id]/trades/page.tsx          Trade center
src/app/(app)/leagues/[id]/activity/page.tsx        Activity + Commissioner Action Log
src/app/(app)/leagues/[id]/commish/page.tsx         Commissioner Console (commish only)
src/app/(app)/leagues/[id]/schedule/page.tsx        Season schedule (member view; commish: edit + Remix §11.7)
src/app/(app)/leagues/[id]/history/page.tsx         History Mode: seasons, franchises (incl. retired), H2H records (§11.6)
src/app/(app)/leagues/[id]/chat/page.tsx            League chat (mobile full-screen; desktop persistent panel on league home)
src/app/(app)/leagues/[id]/draft/recap/page.tsx     Draft recap — real & mock: final board + rosters (mock: delete) (§8.8)
src/app/join/[token]/page.tsx                       Invite claim, pre-auth (resolves invite_code | custom slug | seat token) (§7.2, §12.23)
src/app/u/[username]/leagues/[slug]/page.tsx        Public league page (SEO, read-only summary)
```
> `/u/[username]` (existing profile route) additionally renders the cross-league **managerial record** aggregated from stints (§11.6).

> **The draft room is a full-screen experience and its route stands alone (v2.12 — Chris, 2026-08-17).** `…/leagues/[id]/draft` renders **without the app shell**: no left navigation, no right-hand context rail, no app header. It keeps the app's authentication and username gates — the shell is what is removed, not the guard — which means the auth guard moves ABOVE the shell so both the chrome-free room and every ordinary app route are gated by the same code path. **The route must render correctly from a COLD LOAD every time** — click-through, deep link, refresh mid-draft, and (per the entry rule below) a freshly-opened browser tab, which is by definition a server-rendered cold start with no client history. Cold-load correctness is an acceptance criterion, not an implementation detail.
>
> **Entry is platform-split (v2.12):** in-app entry on **desktop** opens the room in a **new browser tab**; on **mobile** it opens **in place** (a new tab on a phone is hostile — the user cannot find their way back). Both land on the same standalone route. Because a browser can therefore hold two tabs of one room, the client carries a **single-room guard** (§9.3).
>
> **Draft-related notifications do NOT deep-link into the room (v2.12 — Chris, 2026-08-17):** they route to the app home, where the live-draft bar's **Join Draft** CTA is the single entry point into the room. This keeps one entry path that can apply the platform split above; a notification href pointing straight at `/draft` would bypass it.
>
> **Why full-screen, and exactly how far it extends (v2.12 — ruled by Chris, 2026-08-17).** A live draft needs every pixel it has; app chrome on screen mid-draft is space taken from a draft surface — *"having a bunch unnecessary UI mid draft doesn't make sense… you need all the space you have for the draft surfaces"*, which is why ESPN, Yahoo and Sleeper all run the draft full-screen. So the rule is: **the live draft surface is chrome-free.** The pre-start **lobby** shares the `/draft` route and is part of that surface, so it is chrome-free too (and the lobby→live flip stays in place — D120). The **recap** (`…/draft/recap`) is **not** a draft surface — it is a post-draft reading page people revisit days later — so it **stays inside the app shell**, where the app's own navigation is the way out of it.

### 16.2 Key components
```
src/components/leagues/league-create-wizard.tsx     stepper: format → roster → scoring → waivers/trades → draft → invite
src/components/leagues/settings-panel.tsx           grouped, validated settings forms
src/components/leagues/scoring-template-picker.tsx  template cards + compare (v2.7: 6 parity cards at v1; "same game, scored three ways" widget returns with Alpha/Ultra; v2.11: gains the "Customize" fork affordance — §7.3.3.1)
src/components/leagues/scoring-editor.tsx           §7.3.3.1 custom scoring editor (test cohort): position stepper QB→RB→WR→TE→K→D/ST, per-section value grids, All-Positions switch (derived state), live sample-player line per position (Marino/Peterson/Moss/Gronk/Rackers/Seahawks) via the REAL calculator; D/ST tier rows show inherited cut points as read-only labels — only what each tier PAYS is editable (F59 owns boundary editing)
src/components/leagues/scoring-editor-ops.ts        pure ops layer: resolveRules, tier-key generation from cut lists, section/position key catalogs (incl. the code-gated return_yards field), switch-state derivation, normal-form strip — mirrored by the server-side guardrail validation (§7.3.3.1)
src/components/leagues/roster-slot-builder.tsx      per-position starter counts + "Add Custom Flex" (eligible-position multi-select) + bench count + IR spots (each set Restricted/Unrestricted with eligible designations + min weeks); live roster_size + validation
src/components/leagues/invite-panel.tsx             league link (custom slug) + seat-targeted invites (**email-first** — pre-filled/locked signup for new users, §7.2 — plus username/link) + seat list + invite status/revoke
src/components/leagues/franchise-history.tsx        per-franchise manager-stint timeline + record splits (History tab, §11.6)
src/components/leagues/attach-list-modal.tsx        attach a ranking list to a league; set primary board / share
src/components/leagues/league-home-states.tsx       status-driven home: setup checklist → countdown → LIVE → in-season hub → champion (§16.5.1)
src/components/leagues/schedule-view.tsx            week-by-week grid; byes; division tags; commish edit affordances (§11.7)
src/components/leagues/schedule-remix-modal.tsx     regenerate (seeded) → side-by-side diff → system-post preview → confirm (§11.7, §16.4)
src/components/leagues/corrections-view.tsx         stat corrections scoped to league starters; per-team point deltas; post-window commish-apply CTA (§23.4)
src/components/leagues/waiver-claims-panel.tsx      my pending claims: FAAB amounts, drag claim_order, conditional drops, cancel (§13.2)
src/components/leagues/trade-center.tsx             pending/history tabs; review state (commish or league vote w/ tally), veto/approve, deadline chip (§13.3)
src/components/leagues/remove-manager-modal.tsx     takeover / retire-&-succeed / vacate chooser; consequences preview + reason (§7.2.1, E49)
src/components/leagues/acting-as-banner.tsx         commissioner-operating-any-team mode (orphaned, or a still-seated inactive manager, §7.2.1); scoped controls; every action logged
src/components/leagues/claim-invite-card.tsx        pre-auth claim card (league/team/inviter → sign-in/up → seated); mismatch + seat-filled states (E53–E54)
src/components/leagues/stat-line.tsx                box-score row; Alpha/Ultra split rendering (air + YAC · yards ± after contact) + pending-charting badge (§23.5, E55)
src/components/leagues/status-banners.tsx           shared banner/badge system per the §16.5.4 catalog — no one-off treatments
-- Draft room (layout redesigned v2.12 — full-screen, chrome-free; §16.4's room-layout callout is the contract) --
src/components/draft/draft-room.tsx                 layout shell; subscribes to draft channel; reconnect-safe; owns the three-zone frame (command bar / status strip / board) + the dock
src/components/draft/draft-command-bar.tsx          v2.12 — the 54px pinned top bar: commish Pause/Resume + Draft Options, draft status for everyone, MOCK identity, Exit Draft (always, top-right)
src/components/draft/draft-status-strip.tsx         v2.12 — LIVE badge, Round/Pick, draft order, presence, pick clock; ON-THE-CLOCK sits at the strip's LEFT edge
src/components/draft/draft-dock.tsx                 v2.12 — bottom tab bar + slide-up panels (Players/Targets/Roster/Lists/Chat); non-modal drawer, one panel at a time, Esc closes
src/components/draft/draft-options-menu.tsx         v2.12 — the SINGLE home for commissioner power in the room (§8.7); opens commish-draft-panel's sections. The separate "Commish panel" button is retired
src/components/draft/use-single-room-tab.ts         v2.12 — the two-tabs guard (§9.3): newest tab of a given draft holds the connection; older tabs release and offer takeover
src/components/draft/mock-draft-launcher.tsx        "Practice this draft": seat picker + CPU speed toggle + resume/recap list (§8.8)
src/components/draft/draft-board-grid.tsx           rounds × teams pick grid
src/components/draft/pick-clock.tsx                 server-deadline countdown + paused state
src/components/draft/available-players.tsx          searchable/filterable pool w/ Big Board/ADP/tier + league-list overlays, and an "only players on my list" filter
src/components/draft/my-queue.tsx                    drag-to-reorder queue — LABELED "Targets" in all UI (v2.10 naming rule, §8.4)
src/components/draft/my-lists-panel.tsx              league-tagged lists: cheat sheet (incl. per-player notes — v2.10), pool overlay, load-into-queue, primary board
src/components/draft/my-roster-tracker.tsx          slots filling up + needs
src/components/draft/auction-block.tsx              current nomination + high bid + time remaining (prominent), bid input, budgets, max-bid, anti-snipe; team columns per §16.4's v2.10 auction-room-layout callout
src/components/draft/auction-player-table.tsx       expandable table of available players w/ projections, filters, column customization, row actions (v2.10 — §16.4)
src/components/draft/draft-chat.tsx                  realtime chat + system (commish) posts
src/components/draft/commish-draft-panel.tsx        pause/undo/reassign/move/force/reset (commish) — v2.12: retains the control BODY, but is opened only from draft-options-menu; it no longer carries its own trigger
src/components/draft/presence-bar.tsx               who's online / on the clock (Presence)
src/components/draft/draft-setup-panel.tsx          pre-draft config: date/time (league TZ), order method (random/manual/reveal), clock, pause rules (commish)
src/components/draft/mock-recap.tsx                 mock results: full board + your roster vs the CPUs'; delete (§8.8)
-- In-season --
src/components/leagues/lineup-editor.tsx            slot-based starters/bench; per-player 🔒 at kickoff, bench_lock states, DL stint chips (weeks remaining)
src/components/leagues/swap-assignment.tsx          assign one Swap: protect a starter ↔ same-position bench player; armed/triggered state; rendered below Flex, above K/D-ST/IR
src/components/leagues/matchup-view.tsx             head-to-head live scoreboard (Live Mode patterns); ⚑ Report-illegal-lineup entry for any member (§10.2); median/second-opponent rows + total_points leaderboard variant (§16.5.3)
src/components/leagues/standings-table.tsx          tiebreaker-ordered, division-aware
src/components/leagues/playoff-bracket.tsx          seeds, byes, reseed; commish edit affordances (seeds/results) routed through commish-action-modal (§10.1)
src/components/leagues/free-agents-table.tsx        add/claim, FAAB bid modal; locked 🔒 rows once a player's game starts (player_game_lock); fa_hold countdown chips (§7.3.4)
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
- **Commish panel is unmistakable** (distinct accent) and every commish action shows the live system post in chat so the room sees it happen. **(v2.12: "unmistakable" is now carried by the command bar — commissioner power lives behind one labeled `Draft Options` control in the room's own top chrome, not a floating button competing with the board.)**
- **The board is the room (v2.12).** Everything that is not the board earns its place: the two chrome bands are fixed and shallow, and the working panels are *summoned*, not resident. A user who opens nothing should see the draft board and the state of the draft, and nothing else.
- **Say a thing once (v2.12).** With a permanent status bar at the top of the room, any state it announces — paused, mock, reconnecting, on the clock — must not be announced a second time by a banner or an overlay underneath it. One authoritative site per state.
- **Accessible** to WCAG 2.1 AA (focus states, live-region announcements for picks/clock, color-independent status). Run the `design:accessibility-review` skill before handoff. **(v2.12: the dock is a NON-MODAL drawer — the board, clock and command bar stay visible and operable while a panel is open, so it takes no focus trap and makes nothing `inert`; Escape closes it and focus returns to the tab that opened it.)**

### 16.4 Product & UX callouts (NEW v2.0 — flagged for design, not just build)
- **Naming alignment with the product vision:** ship the Restricted-IR preset labeled **"DL"** (Disabled List — eligible designations OUT/IR/Doubtful, `min_weeks = 4`) as a one-tap option in the roster builder, and surface the Swap spot as **"Hot Swap"** in all UI copy. The mechanics already exist (§7.3.2); the names are the feature.
- **Notification matrix (define before Phase D):** who gets pinged for what — your pick is up (push, urgent), outbid (push), trade proposed/resolved (push), waiver won/lost (morning digest), commissioner action affecting you (push + badge), swap fired (push), stat correction changed a result (push). Every push deep-links to the exact surface. Over-notification is the #1 uninstall driver; default to digests for everything non-urgent.
- **Draft-night rehearsal:** surface Mock Draft (Phase F) prominently in the pre-draft lobby ("Test your settings with bots") — commissioners rehearse, and rehearsal is the moment misconfigured settings get caught.
- **Schedule Remix UX:** preview-diff-confirm (never one-tap destructive), with the system chat post shown in the preview so the commissioner knows the league will see it.
- **Stat-correction transparency:** the corrections view (§23.4) is a trust surface — treat it with the same editorial care as the audit log; "your matchup changed and here's exactly why" is the brand.
- **Draft room layout (v2.12 — Chris, 2026-08-17; this callout is the layout contract, and it supersedes the room composition M2 shipped).** The room is a full-screen, chrome-free page (§16.1) laid out in **three zones, top to bottom**:
  1. **The command bar — 54px, full width, ink-filled, pinned.** Present for every user in every room. **Commissioner:** Pause / Resume plus a **Draft Options** menu (§8.7). **Non-commissioner:** the draft's status in words ("Draft paused by @commish"). **Everyone:** **Exit Draft** in the top-right corner — a commissioner must be able to leave too. On a **mock**, the bar carries the MOCK identity and the launcher's practice controls (there is no commissioner in a mock — §8.8); the MOCK banner is absorbed into the bar rather than stacked under it.
     **Exit Draft's behavior (v2.12 — ruled by Chris, 2026-08-17).** It **navigates in place** to league home (`…/leagues/[id]`) on every entry path; it never calls `window.close()` (that only works on a script-opened tab, so it would fail silently on a deep link or a refresh), and it does **not** confirm. Leaving is not free, and the copy must not pretend it is: with the room closed the `draft_touch` heartbeat stops, the seat goes STALE after the 45s freshness constant, and from then on each of that manager's deadlines is held for `disconnect_grace_seconds` and then autopicked from their Targets (§8.5.5's v2.8.13 erratum → §8.4) — *"Exit draft just exits you from the draft room and after a certain amount of time puts you into 'auto draft' mode. Which is how all mock drafts work."* **Returning to the room restores manual control immediately.** Exit therefore fires the **away path only** and **must not set `league_members.is_autodraft`** (§8.4's sticky "Auto-draft me", which keeps picking for a manager *after* they come back): the heartbeat path is the one that hands control back on return, and that is the behavior being described. **The control says what it does** — "Exit Draft" alone is insufficient copy; the affordance states that picks will be made from the manager's Targets while they are away and that returning restores manual control (§16.5.4's designed-copy rule).
  2. **The status strip — one band, directly beneath the bar.** LIVE/PAUSED badge, Round & Pick, draft order, presence, and the pick clock. **"You're on the clock" moves to the LEFT edge of this strip** (M2 shipped it right-aligned against the clock); the countdown stays at the right edge, so the two ends of one band read as *whose turn* and *how long*. There is no third band and no page header — **"Draft Room" as a page title is gone**; the room's identity is the room.
  3. **The draft board — FULL WIDTH**, taking all remaining height. No side rail steals width from it.
  Everything else — **Available players · Targets · Roster · Lists · Chat** — lives in a **bottom dock**: a persistent tab bar across the bottom of the screen whose panels **slide up over** the board and back down. Default state is **closed** (the focused board view is the point), one panel open at a time, the open panel **overlays** the board rather than resizing it — the board's geometry must not move when a panel opens. Tapping the active tab closes it; Escape closes it; the room behind stays live and operable (§16.3).
- **Mobile draft room density (v2.0; RECONCILED with the dock at v2.12).** At 20 teams the pick grid is 20 columns, so the board zone on mobile still collapses to a **ticker + "my picks" rail with the full grid one tap away** — that rule stands and is unchanged. What changes is *where the other surfaces live*: the M2 room's four-way mobile pane switcher (Players / Queue / Full board / Chat) is **replaced by the same bottom dock desktop uses**, so there is now ONE pattern on both platforms instead of two competing ones. Mobile specifics: the dock's tab strip scrolls horizontally if the labels do not fit, a panel opens taller than on desktop (the board behind it is a ticker, not a grid), and the app's own global bottom navigation is **absent** in the room (the room is outside the app shell), so the dock has the bottom edge to itself — no stacked bars.
- **Invite conversion is the growth loop:** the join flow (invite link → signup → seated in league) must be measured step-by-step and owned like a funnel; a league that seats 10/10 managers is the product's best acquisition event. Seat-targeted invites (§7.2.1) get their own funnel cut (the "replacement GM" flow), and the pre-auth claim page shows league name, team name, and inviter — give people a reason to finish sign-up. **Identity display rule everywhere (v2.9):** *Team name — @username*; email never renders in league surfaces, and no name is stored to render.
- **Timezones:** all deadlines (draft time, waiver runs, lock times) display in the viewer's local timezone with the league's reference timezone available on hover; waiver `process_day/time` is stored with an explicit IANA zone chosen at creation.
- **Auction room layout (v2.10 — Chris, 2026-08-15):** every team gets its own column (or row on mobile), ordered by **nomination order**, showing: drafted players with prices · which roster positions remain undrafted · total spots left to fill · total remaining budget · current max bid. At-a-glance visual identification of: **my** team · the team **up for nomination** · the team that placed the **latest bid**. The current nominated player, current high bid, and time remaining stay prominently visible (the `auction-block` centerpiece).
- **Auction player table (v2.10 — Chris, 2026-08-15):** an expandable/collapsible table of all available players with a **"Show Drafted" toggle**. Columns: Projected $Cost (`players.auction_value`) · Dollar-to-Projected-Points ratio (derived) · Projected Total Points (season) · Projected Points (weekly average, derived) · Bye Week (`players.bye_week`) · Strength of Schedule (`players.sos`) · Rushing Att/Yds/TDs · Receiving Tgt/Yds/TDs · Passing Att/Yds/TDs *(the split columns require a projections-sync extension — `players.projected_stats` carries season point totals only today; the table ships with the supported columns, the splits group is code-gated, and the sync extension runs as a **standalone data task in parallel with the M3 build** (ruled 2026-08-16) — the columns light up when both land; tasks-M3 C43)*. Filters: position · text search · **Favorites** (the user's `is_favorites` list). **Column customization**: add/remove stat columns + a Reset-to-default. Per-row actions: **Add to Targets** · **Nominate** · **Do-Not-Draft** label (§12.24).

### 16.5 UI completeness audit — workflows, states & coverage (NEW v2.4)
Everything in v2.0–v2.3 that grew a UI surface is enumerated here; §16.1/§16.2 above are the canonical file lists (extended in v2.4). **The Design Reviewer agent uses this section as its coverage checklist** — a feature without its surfaces below is not done.

#### 16.5.1 League home is a state machine (build it that way)
`league-home-states.tsx` renders by `leagues.status`:
| Status | Hero | Primary CTA | Also on screen |
|---|---|---|---|
| `setup` | **Setup checklist**: settings ✓ · seats *n*/*N* (each empty seat → invite affordance) · scoring template chosen · schedule draft | Invite managers / Schedule draft | Practice-draft card once a draft is configured |
| `scheduled` | Draft countdown (league TZ + local) | **Enter draft lobby** · Practice this draft (§8.8) | Order reveal (if manual/reveal), template card, checklist remainder |
| `drafting` | LIVE badge | **Join draft** | presence of who's in the room |
| `in_season` | This week's matchup card (live scores) | Set lineup (lock countdown) | standings peek · waiver deadline chip · activity feed · trade deadline chip |
| `complete` | Champion banner | View History | final standings, season recap |
Empty/error variants for every card; skeletons on load.

#### 16.5.2 Workflow → surface map (the connective tissue)
| Workflow | Entry point | Screens/controls (in order) | Key states |
|---|---|---|---|
| **Invite & claim** (growth loop) | invite-panel · any empty seat | create league link / custom slug / seat invite → share sheet → **`/join/[token]`** pre-auth card (league, team, inviter) → sign-in/up → seated → land on league home | claim success · username/email mismatch (E53) · seat already filled (E54) · expired/revoked invite |
| **Replace a GM** (§7.2.1) | Commish console → Membership · team page ⚙ | `remove-manager-modal` (takeover / retire-&-succeed / vacate; consequences preview incl. standings-inheritance for retire, E49; reason required) → confirm → (vacate) orphaned badge + `acting-as-banner` when commish operates the team → seat invite → new stint | orphaned team badge everywhere the team renders · retired franchise view (sealed, History) · removed-user notification |
| **Act as Manager (any team)** (§7.2.1, v2.6) | Team page ⚙ → "Act as [Team]" (any team, no removal needed) | confirm → `acting-as-banner` for the session → lineup/waiver/trade screens render as that team → actions tagged `acting_as_team_id`, posted to activity feed as "Commissioner (acting for Team X)" → exit mode | real manager's access is never locked — both can act; each action attributed to its true actor (E66) |
| **Schedule & Remix** (§11.7) | League nav → Schedule · commish console | `schedule-view` (week grid, byes, divisions) → **Remix** → `schedule-remix-modal` (regenerate → side-by-side diff → system-post preview → confirm) | free-before-Week-1 vs audited-override copy · post-kickoff = override styling · edit affordances commish-only |
| **Waivers** (§13.2) | Players page → claim | FAAB bid modal (or priority claim) → `waiver-claims-panel` (drag `claim_order`, amounts, conditional drop, cancel) → run results in activity + notification | pending · won/lost w/ reason (outbid amount if FAAB) · locked player rows (game started) · `fa_hold` countdown chip |
| **Trade lifecycle** (§13.3) | Trade center · player row → propose | `trade-builder` (legality preview) → pending card (counter/accept/rescind) → review state (commish approve/veto or league vote w/ tally) → executed → activity post | under-review countdown · vetoed w/ reason · deadline-passed lock · auto-rescinded (partner removed, E47) |
| **Draft night** (§8) | League home CTA / the live-draft bar's **Join Draft** — the ONE entry point (notifications route here, never to `/draft` directly — v2.12) | lobby (presence, checklist) → order reveal (if configured) → live room **(full-screen, chrome-free; desktop entry opens a NEW TAB, mobile in place — §16.1/§16.4)** → completion → **`/draft/recap`** (final board, rosters — stays inside the app shell) → status `in_season` | paused state announced ONCE, in the command bar (v2.12 — the M2 pause overlay's duplicate copy is retired) · disconnect/reconnect toast · commissioner power behind `Draft Options` · "open in another tab" takeover (§9.3) |
| **Mock draft** (§8.8) | Practice card · draft lobby | `mock-draft-launcher` (seat picker, CPU speed) → same draft room + **the MOCK identity carried in the command bar** (v2.12 — absorbed, not stacked as a separate banner) → `mock-recap` (board, your roster vs CPUs, delete) | resumable-paused card on league home · 72h-expiry note · 3-active cap message · launcher-only practice controls in the bar (no commissioner exists in a mock — D110(1)) |
| **Weekly loop** (§11) | Lineup CTA / matchup card | `lineup-editor` (lock-aware) → live `matchup-view` → `final (pending corrections)` badge → true final → standings update | per-player locked rows · Hot Swap armed/fired chip · median/second-opponent rows (below) · overridden ✸ badge |
| **Stat corrections** (§23.4) | Activity → Corrections tab · push | `corrections-view` (league-scoped, per-team deltas) → if result flipped: matchup shows change note | in-window auto-applied · post-window flagged → commish apply CTA |
| **Illegal lineup** (§10.2) | matchup ⚑ (any member can **Report**) | report modal (rule ref optional) → commish `illegal-lineup-flow` (remedy chooser) → applied + logged + chat system post | reported-pending badge for the reporter · resolved state |
| **Commish override (generic)** (§10) | ⚙ Commish affordances everywhere | `commish-action-modal` (reason required, before/after) → applied → audit entry + non-disableable chat post → ✸ badge on the touched surface | undo (compensating action) · acting-as context when applicable |
| **Alpha/Ultra week** (§23.5) | matchup box score | `stat-line` split rendering (air + YAC · yards ± after contact) → Ultra: YCO **pending** badge until charting posts → settled | provisional vs settled styling · charted-feed-late banner (E57) · flag-gated template card ("coming soon") in picker |

#### 16.5.3 Scoring-mode display variants (settings change the shape of core screens)
- **`total_points` leagues have no matchups:** matchup routes render a weekly **scores leaderboard** instead; standings sort by cumulative points; league home hero = "your week so far vs the field."
- **`median_game`:** matchup list gains a second row — *vs League Median* — with its own W/L chip; standings show the combined record; the median line renders in `matchup-view` once all scores are in (exact-median = tie, per §11.7).
- **`second_opponent`:** two result chips per week (primary + secondary opponent), both feeding the record; H2H history counts both.
- **Divisions:** standings grouped w/ division tags; schedule-view badges division games.

#### 16.5.4 Global banner / badge / state catalog (shared `status-banners.tsx`; never invent one-off treatments)
- **Banners:** "Live stats delayed" (§23.2) · "Charting lands Mon AM" (Ultra, §23.5) · realtime-fallback "reconnecting — scores refresh every 10s" (§9) · deploy-freeze/maintenance (admin-set) · acting-as (commissioner operating an orphaned team).
  - **Inside the draft room, the command bar is the banner surface (v2.12).** Paused, MOCK, and reconnecting are rendered **in the 54px bar** and nowhere else in the room — no stacked banner strip beneath it, and no second telling of the same state by the board overlay (§16.3's say-a-thing-once rule). The shared `status-banners.tsx` treatments still govern *how* each state looks; the room simply has one place to put them.
- **Badges:** `final (pending corrections)` → `final` · ✸ commissioner-adjusted (links to audit entry) · MOCK · LIVE · locked 🔒 (player game started; on lineup rows, FA rows, trade assets) · `fa_hold` countdown · Hot Swap armed/fired · DL stint (weeks remaining) · orphaned · retired franchise · pending-charting · autopick-on (draft seat) · **acting-as (any team, not only orphaned)**.
- **Required states per data surface:** skeleton-loading, empty (designed copy, not blank), error-with-retry, degraded (banner + last-good data, never wrong numbers).
- **Timezone rule everywhere a time renders:** viewer-local with league TZ on hover (§16.4).

#### 16.5.5 Deliberately *not* in v1 UI (so nobody builds them by accident)
Custom scoring editor *(v2.11: un-punted for the 2026 test cohort ONLY — §7.3.3.1; the GA default posture stays templates-only until its gate passes)* · standalone/multi-human mock lobbies (v1.1, §8.8) · odd-team-count byes and 18/20-team leagues (v1.1, OQ 12) · History Mode paywall (open question) · admin/ops kill-switch surfaces (internal tooling, §24.2 — not league UI).

---

## 17. Permissions & Access Control Matrix

| Action | Guest | Manager | Co-Commish | Commish |
|---|---|---|---|---|
| View public league summary | ✓ | ✓ | ✓ | ✓ |
| View full league (rosters, chat, activity) | — | ✓ (member) | ✓ | ✓ |
| Create league | sign-up first | ✓ (free — v2.8) | ✓ | ✓ |
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

> **v2.0 note:** the v2.0 additions (schedule engine + Remix, `score-league-week` fan-out, stats contract, game-day locks, new §12.17–12.21 tables, ops) are folded into these phases and re-sequenced — with per-milestone exit criteria, QA gates, and the agent operating loop — in `docs/specs/delivery-plan-redraft-leagues.md`. That doc is the build sequencer; this spec stays the source of truth for *what* to build.

### Phase A — League foundation & settings
- Migrations: ALTER `leagues`, add `league_members`, RLS helpers (§12.0–12.2).
- Create-league wizard, settings panel, scoring editor, roster-slot builder, invites/join (league link + custom slug + seat-targeted invites, §12.23), roles, placeholder seats, **manager stints written from day one** (`team_managers`, §12.22 — retrofitting stints later means guessing at dates), lifecycle status. Attach existing ranking lists to a league (`league_lists`, §7.4/§12.15).
- **Gate:** a commissioner can create an 8/10/12/14/16-team league, fully configure it (defaults valid), invite & seat managers, and reach `scheduled`.

### Phase B — Snake draft engine
- Migrations: `drafts`, `draft_picks`, `draft_queues` + RPCs (`draft_start`, `draft_make_pick`, `draft_undo`, `draft_tick`) + `draft-tick` worker.
- Draft room (board, clock, pool, queue, roster tracker, chat, presence), autopick, disconnect grace, commissioner panel (pause/undo/reassign/move/force/reset). **My Lists** panel — view league-tagged lists, overlay on the pool, load into the queue — with primary-board autopick (§8.9).
- **Gate:** run a full snake draft to completion with live clients; commissioner can pause, undo (single + cascade), reassign a pick, and move a drafted player between teams; disconnect/reconnect is seamless; `league_rosters` populated; status → `in_season`; **a solo mock snake draft (§8.8) completes against CPU opponents with realistic timing and zero league side effects.**

### Phase C — Auction draft engine
- Migrations: `draft_bids` + RPCs (`draft_nominate`, `draft_place_bid`, auction `draft_tick` path).
- Auction block UI: budgets, max-bid, nomination/bid clocks, anti-snipe; commissioner budget/undo controls.
- **Gate:** run a full auction with budgets enforced (no overspend, every team completes a legal roster), anti-snipe works, commissioner can reverse a won bid and adjust budgets; **mock auctions run with CPU bidders that obey the solvency invariant.**

### Phase D — In-season play
- Migrations: `league_rosters`, `matchups`, `transactions`, `waiver_claims`, `trades`/`trade_items`; extend `team_lineups`.
- Schedule generation, lineup editor + lock, live matchup scoring (reuse Live Mode), standings + tiebreakers, waivers/FAAB job, free agency, trade center + review/veto, activity feed, playoffs/bracket. **Swap spot** auto-substitution (assign + arm at lock; `process-swaps` fires pre-game/in-game).
- **Gate:** a league plays a simulated week end-to-end: set lineups → lock → live scores → finalize → standings update; waivers process; a trade completes under review; playoffs generate.

### Phase E — Commissioner Console + Audit Log (the differentiator)
- Migration: `commissioner_actions` (+ FKs on matchups/transactions) and the `logCommissionerAction()` helper wired into every override RPC.
- Commissioner Console (all powers §10.1), reason-required modal, before/after diffs, illegal-lineup guided flow, member-visible audit log with "✸ commissioner" badges + auto chat posts.
- **Gate:** every override path writes an immutable, member-visible log entry with a required reason and correct before/after; changing a matchup result from the illegal-lineup flow works and is visible to all members; no override can occur without a log entry; audit entries cannot be edited/deleted by anyone.

### Phase F — Polish & extras
- Draft order reveal animation, notifications wiring, History Mode tab, hash-chain tamper-evidence on the audit log, performance pass on the draft room (up-to-20-team concurrency), full accessibility pass, public league SEO page, optional auto-sub inactives. *(Mock drafts were promoted to Phases B/C in v2.3 — §8.8.)*
- **Gate:** load/concurrency test a 20-team live draft; Lighthouse/CWV acceptable; `design:accessibility-review` passes.

> **Stack note for Claude Code:** the repo `CLAUDE.md` lists React Query + Zustand for state and `@supabase/ssr` clients. Use Zustand for ephemeral draft-room UI state (timer display, selected player, panel open) and React Query + Realtime subscriptions for authoritative data. All draft/transaction writes go through Route Handlers calling the RPCs — never write these tables from the client.

---

## 19. Acceptance Criteria & Test Cases

### 19.1 Functional acceptance (must all pass)
- Create leagues of every supported size (**8, 10, 12, 14, 16**); defaults produce a valid, draftable configuration with no manual fixes.
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
- League creation and joining are both free (v2.8 ruling — no Pro gate anywhere on the create/join surface).

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
| E25 | Auction endgame: team has $3 left and 3 open slots | Max bid enforced at $1; system allows only $1 bids; nomination validation confirms the nominator can afford their own opening bid. |
| E26 | Auction: bid clock expires with no bids beyond the opening | Nominator wins at the opening bid (validated affordable at nomination time); roster/budget update; nomination advances. |
| E27 | Auction: a team's roster fills mid-auction | Team is skipped in the nomination rotation and cannot bid; UI shows "roster complete". |
| E28 | Commissioner edits a team's auction budget below its committed spend or below solvency (open_slots × min_bid) | Rejected with a clear explanation — the solvency invariant cannot be broken even by an override; commissioner may instead reverse won bids. |
| E29 | Commissioner triggers cascade undo while a nomination has live bids | Nomination is voided (bids returned), then picks revert; all clients converge; single audit entry with full before/after. |
| E30 | Autopick would take a K/DST in round 3 | Deferral heuristic: K/DST are ineligible for autopick until (open slots − remaining picks) forces them or round > total_rounds − 3. |
| E31 | Snake draft order edited by commissioner after pick 15 (override) | Remaining picks re-derive from the new order; completed picks unchanged; audited; room broadcasts the new order. |
| E32 | `player_game_lock` on: manager tries to add a player whose game kicked off 10 min ago | Blocked: "locked until the week clears (Wed 6am ET)"; `league_player_pool.locked_until` enforces it in the RPC, not just UI. |
| E33 | `bench_lock` on: waiver claim's drop player already played | Claim fails at processing with reason `drop_locked`; FAAB not spent; manager notified; matches Sleeper's Bench Lock semantics. |
| E34 | Player dropped mid-week after starting (bench_lock off, incumbent-lax config) | The locked starter's stats still count for the dropping team's matchup that week; the player enters waivers; edge documented in UI copy. |
| E35 | Trade accepted while one included player's game is live | Execution defers to the next lock-free moment for all included players (or fails per setting `trade_lock_behavior`); rosters never change mid-game. |
| E36 | Uneven trade (2-for-1) would overflow the receiving roster | Acceptance flow requires selecting drop(s) as part of the same atomic execution; the trade cannot leave an illegal roster. |
| E37 | Pending trade invalidated (an included player was dropped/claimed elsewhere) | `trade-review-expiry`/validation job marks it `invalid` immediately with a reason; both parties notified — never fails silently at execute time. |
| E38 | Two-decimal tie in H2H (98.24 vs 98.24) | `result = 'tie'`; standings W-L-T and tiebreakers handle ties; no hidden extra precision is consulted. |
| E39 | Median game: team scores exactly the median | Median result = tie (Sleeper rule); records show e.g. 1-0-1 for the week. |
| E40 | Second opponent generation | Never pairs a team with its primary opponent or itself in the same week; per-week derangement validated. |
| E41 | Remix invoked after Week 1 kickoff | Blocked as Remix; offered as a commissioner override (reason required) affecting only `scheduled` future weeks; system chat post fires. |
| E42 | NFL flexes SNF: a rostered player's kickoff moves from 1:00 to 8:20 | All locks (lineup, add/drop, swap) move automatically because they're evaluated from `nfl_games.kickoff_at` at runtime; no stale locks. |
| E43 | Game postponed out of the league week | Affected players score 0 for the week; locks release; system note posts; commissioner override available; finalization proceeds without the postponed game. |
| E44 | Stat correction arrives Wednesday changing a matchup result | Auto-recompute (non-overridden cells) + system note + corrections view entry; standings/waiver priority recompute; if it arrives after the window, it's flagged for optional commissioner apply instead. |
| E45 | Provider outage for 10 minutes during Sunday games | UI shows "Live stats delayed"; no wrong data shown; on recovery, ingestion back-fills and fan-out catches up; finalization is unaffected (requires all games final + window). |
| E46 | Swap-out player's OUT designation arrives only after the game ends | Deterministic re-check at game final still resolves the swap (greater-of rule); result identical whether the feed was fast or slow. |
| E47 | Manager removed while their trade offer is pending with another team | Offer auto-rescinds on stint close; counterparty notified; commissioner may re-propose acting-as if the trade was fair (logged). |
| E48 | Manager removed mid-draft | Seat flips to autopick on the same pick clock; stint closes; a replacement can claim via seat invite mid-draft and resume picking manually. |
| E49 | Retire & succeed executed mid-season | Successor inherits roster/FAAB/schedule slot and W-L **for seeding only**; History partitions at `retired_at_week`; both consequences shown in the confirm dialog; audited override. |
| E50 | Removed manager's live session writes a lineup seconds after removal | Write access derives from the open stint → denied atomically with stint close; no race window, no cleanup job. |
| E51 | Previously removed manager re-invited to their old franchise | New stint on the same `team_id`; History shows both stints; no data merge. |
| E52 | Username changed mid-season | **Obsolete per v2.8 (usernames are permanent — Q4 ruling); retained for the record.** ~~Every league surface updates live (joins on `user_id`); audit + chat re-render under the new handle.~~ |
| E53 | Seat-targeted invite claimed by the wrong account (link forwarded) | If `invited_username`/`invited_email` is set → claim rejected with a friendly mismatch screen; if unrestricted, claim succeeds (commissioner chose an open link) and is recorded. |
| E54 | Two seat invites for the same team claimed near-simultaneously | Claim RPC hits the one-open-stint unique index; second claim fails gracefully ("seat already filled"), invite marked expired, commissioner notified. |
| E55 | Ultra league, Sunday night: charted YCO not yet posted | Scores show live-provisional with a "charting lands Mon AM" badge on the YCO component; never a silent 0; matchup can't finalize early anyway (Thu window). |
| E56 | Charted feed revises a YCO number on Wednesday | Flows through `stat_correction_events` like any correction: in-window auto-recompute + system note + corrections-view entry. |
| E57 | Charted feed misses its SLA for the whole week (vendor outage) | Ultra leagues see an honest banner; commissioner waits or finalizes with a logged override scoring YCO = 0 for the week (reversible via rescore §10.1). Alpha leagues unaffected. |
| E58 | Tracking feed reports `yards_after_catch` > `receiving_yards` on a play (fumble-forward edge) | Ingestion clamps per the PFR convention (air + YAC may ≠ total on fumble yardage); reconciliation job (§23.2) asserts per-player consistency; discrepancies flag, never silently score. |
| E59 | User abandons a mock mid-draft and never returns | Mock auto-pauses on disconnect; resumable from the league page; the 72h expiry cron deletes it; zero league impact either way. |
| E60 | User has an active mock when their league's real draft goes live | Both run independently (separate draft_ids/channels); the real room always takes UI priority; mock notifications are suppressed during a live league draft; the mock never blocks or leaks into the real draft. |
| E61 | A league's rules snapshot contains a stat key the environment's provider never delivers | The component renders as *pending/0* with an honest badge — never a silent wrong total; feature-flag gating (§7.3.3) should prevent the state, and the reconciliation job flags it if it occurs. |
| E62 | CPU auction bot pushed to its budget edge by a human's bid-up | Bots run the same max-bid/solvency validator as humans; the §8.6.8 property test extends to bot-driven mock auctions — no reachable bot sequence violates solvency. |
| E63 | Three or more teams tied on Win % and Points For at playoff seeding | Head-to-head has no clean comparator for 3+ teams (records can cycle); skipped for that group; chain falls through to Points Against. |
| E64 | Playoff seeding tie in a `total_points` league (§11.7) | No matchups exist, so no head-to-head data; chain skips directly from Points For to Points Against. |
| E65 | Seat-targeted invite sent by email, claimed via brand-new signup | *(Erratum v2.8.10 — reconciled with F2/§12.23:)* the pre-auth claim page CANNOT pre-fill/lock the email field to `invited_email` (the anon `get_join_preview` surface must never disclose it — F2), so it directs the fresh signup to use the email the invite was sent to and relies on the server-side gate: `claim_league_invite` validates the signed-in JWT email against `invited_email` case-insensitively (E53) and refuses on mismatch with the invite left intact. A wrong-account claim (fresh signup with a different email, or an existing session already signed in as another account) hits the E53 friendly-mismatch screen. |
| E66 | Commissioner enters "Act as Manager" for a still-seated (non-orphaned) team while the real manager is simultaneously active | No access lock on either side; both can act; last write wins; every action is attributed to its true actor (commissioner vs. manager) in the activity feed and audit log. |

### 19.3 Verification approach (for the build)
- **Unit:** scoring math, tiebreaker ordering, snake-order generation (incl. 3rd-round reversal), auction max-bid, FAAB resolution, roster legality/eligibility.
- **Integration (DB):** RLS policies per role (member/non-member/commish), exclusivity unique index, audit immutability, RPC validators.
- **E2E (Playwright):** full snake draft, full auction, disconnect/reconnect, commissioner overrides, a simulated scored week, waiver run, trade under review. Use `npm run test` / `npm run test:e2e` (already in `CLAUDE.md`).
- **Load:** the §22.6 suite — 50 simultaneous 20-team drafts, an auction bid storm, a replayed real NFL Sunday across 500 seeded leagues at 1× and 4× speed, and a 24h connection-churn soak. (Supersedes the v1.x "14 concurrent drafters" test.)
- Run `design:accessibility-review` and a `security-review` of the RLS/RPC surface before launch.

---

## 20. Success Metrics (feature-specific)
| Metric | Target (first season post-launch) |
|---|---|
| Leagues created | 1,000 |
| Drafts completed | 800 (≥80% of created leagues draft) |
| Draft completion rate (started → finished without abandonment) | ≥ 95% |
| New leagues choosing FieldScout Alpha or Ultra (differentiator adoption) | ≥ 25% |
| Median draft-room action latency (pick→broadcast) | < 500 ms |
| Weekly active managers during season | 6,000 |
| Leagues using ≥1 commissioner override | ≥ 40% (validates the differentiator is used) |
| Manager-reported trust in commissioner fairness (survey) | ≥ 4.3/5 |
| Pro conversions attributable to league creation | *(v2.8: creation is free — metric retired as written; replace with a Pro-league-features driver metric when those features are defined)* |
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
12. **Odd team counts (7, 9, 11…) with weekly byes, and 18/20-team leagues** — incumbents support 4–20 including odd; v1 is even 8–16 (Chris's call, v2.6). *Rec: v1.1 fast-follow for both — the schedule engine (§11.7) already models byes (`away_team_id NULL`) and the draft engine needs nothing for odd counts; 18/20 is just re-widening the `team_count` CHECK constraint and re-running the Phase A/§22 load gates at that size — no new engineering either way.*
13. **`second_opponent` QA priority** — ship on at GA or dark-launch? *Rec: build with `median_game` (shared `team_week_results` plumbing) but keep off-by-default and out of the v1 QA-critical path.*
14. **Stats provider for GA** — stay on the Sleeper-based feed vs. contract SportsDataIO (or Sportradar push)? *Rec (v2.5): no rush — build and fully validate the entire pipeline (draft → scoring → corrections → Alpha/Ultra) against the free **synthetic** tier (§23.6) first; layer in `sleeper_free` for beta's real-world signal; make the paid-vendor call only when GA revenue timing actually requires it, informed by real accuracy/latency observed in beta. The `StatsProvider` interface (§23.1) makes it a swap whenever that is.*
15. **Realtime scale escape hatch** — if concurrency outgrows managed quotas, Team-plan custom limits vs. self-hosted Realtime vs. dedicated provider for the socket layer? *Rec: decide only if §24.1 headroom alerts fire two weeks running; the Broadcast-from-DB design (§9) keeps all three options open.*
16. **Charted-data license for Ultra** *(deferred pending funding — see v2.7 changelog)* — which vendor for `rush_yards_after_contact` (SportsDataIO advanced tier vs. SIS vs. FTN vs. PFF), at what cost, with what delivery SLA (must land by Mon AM ET)? *Rec: quote all four during beta; tracking-tier stats are free (public pbp), so this license is the only data cost Alpha/Ultra add — and only Ultra needs it. Ship Alpha at beta regardless.*
17. **Alpha/Ultra coefficient sign-off** *(deferred pending funding — see v2.7 changelog)* — accept the calibrated values from the 2026-fixture backtest (target: positional weekly means within ±10% of Half-PPR)? *Rec: Chris reviews the backtest report + worked examples before template copy freezes; the coefficients are product voice, not just math.*
18. **Yahoo Full-PPR variant** — v1 ships Yahoo Standard + Yahoo Half-PPR (their default). Add a Yahoo Full-PPR ninth template if migrating leagues ask? *Rec: wait for demand; it's a one-row insert.*
19. **"End the draft" (auction) semantics (v2.10)** — Chris requires the control; what it does is unruled. Options: (a) end = every remaining open slot goes unfilled, league → `in_season` with short rosters (managers fill via free agency); (b) end = system fast-fills remaining slots at $min_bid via the autopick chain, then completes normally; (c) end = a paused terminal state needing an explicit commissioner completion choice. *Rec: (a).* **RULED 2026-08-16 (Chris): option (a) — "End as-is → in_season."** Drafted players keep their prices, unfilled slots stay empty, free agency fills later. The §8.7 End-draft row carries the behavior; built in M3 (tasks-M3 C41).
20. **Do-Not-Draft marks × autopick (v2.10)** — should autopick/system-nomination skip a DND-marked player for that user's team? *Rec: skip-unless-forced.* **RULED 2026-08-16 (Chris): DISPLAY-ONLY — the skip behavior was offered and explicitly DECLINED** (recorded so it is never re-proposed as an oversight). DND is a visual label in the player table only; autopick, the Targets fallback, and system nominations ignore it entirely — the engine never reads `draft_dnd_marks` (tasks-M3 C42).

---

## 22. Scale & Capacity Engineering (NEW v2.0) — "hundreds of leagues, live"

Explicit target: **500 concurrent leagues in-season** (≈6,000 managers), with peaks of **150 simultaneous live drafts** (Labor Day week evenings) and **Sunday 1:05pm ET scoring storms**, on the existing Supabase + Vercel stack — no new infrastructure.

### 22.1 Load model (design numbers; load tests must confirm)
| Surface | Peak assumption | Derived load |
|---|---|---|
| Draft night | 150 drafts × 20 clients | 3,000 realtime connections; ~1 pick/draft/30s ⇒ ~5 authoritative events/s ⇒ ~100 broadcast msgs/s fan-out |
| Auction bursts | bids cluster on one nomination | ≤ 5 bids/s/draft, serialized by the draft-row lock; loser gets instant "outbid" |
| Sunday scoring | 300 leagues with viewers, avg 4 viewers | 1,200 connections; 1 batched `scores_updated`/league/10s ⇒ 30 msgs/s × fan-out 4 = 120 msgs/s |
| Stats ingestion | ~13 concurrent games, poll 20–30s | ~500–2,000 changed player-stat rows/min entering the fan-out queue |
| Waiver runs | Wed 3am local staggered | dozens of leagues/min through the queue; each league atomic |
These sit comfortably inside Supabase Realtime quotas (connections, msgs/s, joins/s are per-plan; overage is $10/1k peak connections, $2.50/1M messages) **only because** of Broadcast-from-DB + per-league batching (§9). Alert at 70% of any quota (§24).

### 22.2 Scoring fan-out (server-side; replaces v1.x client-side recompute)
```
sync-live-stats (poll provider, 20–30s in game windows)
  → upsert player_stats (idempotent diff; unchanged rows skipped)
  → enqueue changed (season, week, player_id) into pgmq 'score_fanout'
score-league-week worker (Edge Fn, cron every 5–10s in game windows)
  → drain queue in batches; map player_ids → affected (league_id, team_id)
      via idx on league_rosters(player_id) ∩ leagues in season-week
  → per league: recompute affected matchup team scores + team_week_results
      (pure fn: the §7.3.3 generic calculator, src/lib/leagues/scoring/, against the league's scoring SNAPSHOT)
  → single UPDATE per matchup ⇒ trigger broadcasts one compact event per league
```
- Batching rule: coalesce a league's updates within a 5–10s window into one write/broadcast.
- Recompute is **incremental** (only teams rostering changed players) with a `rebuild` path for corrections/overrides.
- Overridden cells (`matchups.is_overridden`) are never auto-recomputed (existing rule; enforced here).

### 22.3 Job architecture at N leagues (pattern for every scheduled job)
- **One** pg_cron entry per job (Supabase Cron supports 1–59s sub-minute schedules) — never one cron per league.
- The job claims due work with `FOR UPDATE SKIP LOCKED` (e.g., `drafts WHERE status='live' AND current_deadline < now()`, `leagues WHERE waiver_next_run_at < now()`), processes each item in its own transaction, batch-limited, looping until empty. Concurrent invocations are safe by construction; Edge Function timeouts are absorbed by re-claiming.
- Long fan-outs (waivers, corrections, finalization) go through **pgmq** queues with visibility timeouts for retry; every job handler is **idempotent** (keyed on league_weeks / claim ids).
- `draft-tick` keeps its immediate self-invocation after each user action for tight timers; the 5s cron is the safety net. Supporting index: `idx_drafts_due ON drafts(current_deadline) WHERE status='live'`. *(Erratum v2.8.13 — the same D87 vehicle erratum as §8.2/§14; this restatement was missed in the original fold-back and marked 2026-08-04, R133: there is NO self-invocation — `draft-tick` is the in-database `draft_tick()` RPC scheduled directly by pg_cron every 5s, and "tight timers" is satisfied in-database (every action RPC sets the next deadline synchronously; the ≤5s cron enforces expiry). pg_net self-invocation remains the recorded escape hatch if 5s proves coarse. The supporting index stands as printed.)*

### 22.4 Database scale
- **Partition `player_stats` by season** (LIST) at creation; prune old-season partitions from hot cache. All other league tables stay unpartitioned in v1 (500 leagues × a season ≈ low millions of rows — fine with the specified indexes).
- Hot-path indexes (additive to §12): `league_rosters(player_id)`, `matchups(league_id, season, week) WHERE status != 'final'`, `transactions(league_id, created_at DESC)` (exists), `team_week_results(league_id, season)`.
- Connection budget: Route Handlers use Supavisor transaction pooling; RPC-heavy design keeps transactions short. Workers reuse one pooled connection per invocation. No long-lived locks except the per-draft row lock (held < 50ms per action — assert in tests).
- League settings + scoring snapshots are read-heavy: cache in the worker per invocation; never per-player.

### 22.5 Abuse & rate limits
- Route-layer per-user limits: 10 mutations/10s/league, chat 5 msgs/10s, bids 5/s (server also serializes via the draft lock). 429 with retry-after; never silently drop.
- Idempotency (`action_id`) extends beyond the draft to add/drop, waiver submit, and trade actions (unique per league) so mobile retries are safe.
- Invite codes rotate on demand; join attempts rate-limited by IP+code.
- Mock drafts (§8.8): max **3 active per user**, creation 5/hour/user; abandoned mocks expire at 72h via a daily cleanup cron. Mocks share every live-draft rate limit above.

### 22.6 Load & soak tests (gate for GA — see delivery plan)
k6 scenarios, run against staging with production-shaped data: (1) 50 simultaneous snake drafts, 60s clocks, 20 bots each — assert p95 pick→broadcast < 500ms, zero duplicate picks; (2) auction bid storm — 20 bids in 2s on one nomination; (3) Sunday storm — replay a recorded real NFL Sunday's stat deltas at 1× and 4× speed across 500 seeded leagues — assert scoring lag p95 < 15s behind ingestion, no missed corrections; (4) 24h soak with connection churn — assert zero realtime-quota violations and no connection leaks.

---

## 23. Stats Ingestion & NFL Data Contract (NEW v2.0)

The whole product rides on the stats pipeline. v1.x said "reuse Live Mode"; v2.0 pins down the contract that Live Mode must satisfy to host real leagues.

### 23.1 Provider strategy (abstraction required)
- All ingestion goes through a **`StatsProvider` interface** (`getWeekStats`, `getGameStates`, `getInjuries/Inactives`, `getSchedule`) so the provider is swappable without touching league logic. Player identity is already Sleeper-keyed (`players.id` TEXT); the adapter owns any external-ID mapping table.
- **Three environment tiers, same interface (v2.5 — prove the pipeline free, pay only to go live):**
  | Tier | Implementation | Cost | Used for |
  |---|---|---|---|
  | `synthetic` | `SyntheticStatsProvider` (§23.6, new) — generates realistic stat lines incl. advanced stats, on a controllable virtual clock | $0 | Every dev/CI session; the full nightly sim suite; end-to-end validation of the entire pipeline before any vendor is contracted |
  | `sleeper_free` (v1 beta) | current Sleeper-based feed | $0 | Real free leagues in beta; real-world accuracy check on top of what synthetic already validated |
  | `sportsdataio` / `sportradar` (GA) | licensed, SLA'd | paid (Open Question 14) | Paid/GA leagues once the whole pipeline is already proven |
  A league/environment picks its tier at config time; the calculator, locks, corrections, and realtime fan-out run identically regardless — none of that code knows or cares which tier is live.
- **GA upgrade path (decision needed, Open Question 14):** SportsDataIO (REST polling, fantasy-focused, self-serve entry tier, SLA on paid plans) → Sportradar (push feeds, 1–2s latency, official-grade; premium). The interface makes this a swap, not a rewrite. Real-money features (out of scope) would force the licensed tier. **The synthetic tier means this decision is on the critical path for GA revenue, not for finishing the build** — every feature in §7–§22 can be built, demoed, and load-tested end-to-end before it's made.
- **Official inactives ~90 min pre-kickoff and in-game injury designations are a hard requirement** of whichever *live* provider is running — Swap spots (§7.3.2) and `auto_sub_inactives` (§11.3) depend on them; the synthetic provider fabricates these on a schedule so the logic is tested before a real feed ever supplies them.

### 23.2 Ingestion invariants
- Poll cadence 20–30s in game windows (existing two-speed cron). Every upsert is **idempotent** and **diff-aware**: unchanged rows are skipped so the fan-out queue only sees real deltas.
- Provider outage: after 3 failed polls, raise a `stats_degraded` incident flag — league UIs show a non-alarming "Live stats delayed" banner (never wrong numbers, just honest staleness); scoring resumes and back-fills on recovery. No league state is ever advanced on partial data (finalization requires all games `final` + window elapsed).
- A **reconciliation job** (nightly + at correction-window close) recomputes every league-week team score from raw `player_stats` and asserts it matches stored `matchups`/`team_week_results` (excluding overridden cells). Drift ⇒ alert, never silent fix.

### 23.3 NFL calendar realities (each has an edge case in §19.2)
- **Flex scheduling / game moves:** lineup & transaction locks derive from `nfl_games.kickoff_at` **at evaluation time** — never precomputed and stored per lineup. A moved kickoff moves the lock automatically; `lineup-lock` re-scans game times each run.
- **Postponed beyond the league week:** players in a game postponed out of the `nfl_weeks` window score 0 for that week (incumbent behavior); their locks release when the kickoff moves; a system note posts to affected leagues; commissioner overrides remain available for house-rule fairness.
- **International/early games (9:30am ET) and Saturday games (Wks 15–18):** no special-casing anywhere — all logic is kickoff-driven; Swap lock language "first Sunday kickoff" is implemented as "first kickoff of the week's main slate per `nfl_weeks`", handling early windows correctly.
- **Week advancement:** a `league-week-advance` job flips `league_weeks.status` on `nfl_weeks` boundaries; no code ever infers "current week" from wall-clock math.

### 23.4 Stat corrections (industry-normed)
- Incumbent practice: Sleeper applies corrections up to and including **Thursday** after the week; Yahoo until the first game of the next week. FieldScout default `stat_correction_window` = **Thursday 06:00 ET** (configurable 0h–7d, §7.3.6).
- Detection: ingestion diff after a game is `final` ⇒ `stat_correction_events` rows ⇒ fan-out recompute of affected, non-overridden league cells ⇒ system note in affected leagues. Matchups display `final (pending corrections)` until the window closes; true `final` (and waiver/standings dependencies) only after.
- A correction landing **after** the window is *not* auto-applied — it surfaces as a flagged event the commissioner may apply via override (keeps late corrections from silently flipping decided playoff games; strictly better than incumbents' silent behavior).
- **League-facing "Stat Corrections" view** (League → Activity): corrections filtered to players started in that league (Sleeper-style), showing point deltas per team.

### 23.5 Advanced-stat feeds & capability tiers (NEW v2.2 — powers FieldScout Alpha/Ultra)
The §7.3.3 house templates score stats no incumbent scores; the pipeline must treat them as first-class.

- **Provider capability tiers** (declared by each `StatsProvider` adapter; league creation gates templates on them, §7.3.3):
  | Tier | Stats | Source & latency | Required by |
  |---|---|---|---|
  | `core_box` | all Appendix B.1 + B.4 categories *(citation fixed v2.7.1 — Appendix B ends at B.4; B.2–B.3 are the deferred Alpha/Ultra templates)* | box score, live | every template |
  | `tracking` | `air_yards` (completed), `yards_after_catch` | NGS player-tracking–derived; in official NFL play-by-play since 2016; **live-capable** via provider pbp; self-computable from nflverse as a free T+1 fallback | Alpha, Ultra |
  | `charted` | `rush_yards_after_contact` (broken tackles reserved v1.1) | film charting (PFF/SIS/FTN-class licensing, or SportsDataIO advanced tier); **T+1** (next morning), occasionally revised | Ultra |
- **Storage (v2.3 extensibility rule):** all advanced stats — `air_yards`, `yards_after_catch`, `rush_yards_after_contact`, and **every future stat** — live in `player_stats.advanced JSONB DEFAULT '{}'`. A missing key means *not-yet-reported* (≠ 0, renders as pending). New stats therefore require **no migration**; promote a key to a typed column only if query patterns ever demand it (a view can flatten). Ingestion is diff-aware per §23.2; charted arrivals fan out through the same `score-league-week` path.
- **Registry additions for the custom editor (v2.11, §7.3.3.1):** `STAT_KEYS` gains **(a)** a `scoring_surface` field — `'scorable'` (editor-exposed; the core_box column/derived keys templates draw on) vs `'context'` (raw sources `def_points_allowed`/`def_yards_allowed` + aggregates `fg_made`/`fg_attempted`/`pat_attempted`/`pass_attempts`/`pass_completions`/`rush_attempts`/`targets` — never scorable in a format-2 doc, validation-rejected) vs `'reserved'` (deferred bonuses, placeholders, IDP) — and **(b)** the named **tier-family definitions** as **cut lists** (shared PA `[0,1,7,14,21,28,35]`, ESPN PA `[0,1,7,14,18,28,35,46]`, YA `[0,100,200,300,350,400,450,500,550]` — the same boundaries `derive-stats.ts` owns, expressed as the cut points that generate today's key names byte-exactly per §7.3.3.1), which the §7.3.3.1 tier-exclusivity guardrail validates against. Points-allowed and yards-allowed are **independent, additively-scored tables** — never alternatives — each with its own cut list. `return_yards` is a candidate new key via the checklist below (**Q13 ruled 2026-08-16**: ships when a source is found, as the 4-step change spelled out in §7.3.3.1's Special Teams bullet; no column/mapping exists today).
- **New-stat checklist (v2.3 — target: one small PR):** (1) provider adapter maps the feed field → a registry key; (2) the key + display label + tier (`core_box`/`tracking`/`charted`) + pending semantics are added to the code-level `STAT_KEYS` registry; (3) a template (or future custom system) references the key in its `rules`; (4) done — the generic calculator (§7.3.3) needs no change, storage needs no migration, and the two-phase/correction machinery applies automatically by tier. This checklist is the reason FieldScout can score whatever the data industry ships next before incumbents finish a planning cycle.
- **Two-phase scoring for `charted` leagues (Ultra):** during games, scores are **live-provisional** — box + tracking stats count; the YCO component renders as *pending* (badge: "charting lands Mon AM"), never as a silent 0. When the charted feed posts (`advanced_final_at` per game), scores settle and the badge clears. **Finalization timing does not move:** charting lands Mon–Tue, comfortably inside the Thu 06:00 ET correction window (§23.4) that finalization already waits for — the v2.0 design absorbs the lag for free.
- **Charted revisions** flow through `stat_correction_events` (§23.4) like any correction: in-window auto-recompute + system note; post-window flagged for commissioner apply.
- **Degradation:** if the charted feed misses its SLA for a week, Ultra leagues see an honest banner and the commissioner may (a) wait, or (b) finalize with a logged override scoring YCO at 0 for that week (league-visible, reversible via rescore). Alpha is immune — all its stats are live-tier.
- **Cost note (Open Question 16):** tracking-tier data is effectively free (public pbp) — the licensing decision is the charted tier only, and only Ultra needs it.

### 23.6 `SyntheticStatsProvider` — validate the whole pipeline before paying for data (NEW v2.5)
Directly answers "does this work" without a stats contract. Same `StatsProvider` interface as §23.1; everything downstream — calculator, locks, corrections, realtime fan-out, standings — is identical code whether the tier is `synthetic`, `sleeper_free`, or a paid vendor.

- **What it generates:** plausible box-score lines (`core_box`) for a configurable slate of games, plus fabricated `air_yards`/`yards_after_catch` (`tracking`) and `rush_yards_after_contact` (`charted`) so **Alpha and Ultra are exercisable with zero data cost** — the whole point of the extensibility contract (§7.3.3) is that a stat's *plumbing* doesn't care whether the number is real.
- **Runs on the `TimeProvider` virtual clock (§23.1/M0):** a "week" can play out in real time, at 64×, or be driven step-by-step from a test — kickoff, in-game deltas, final, and (critically) a T+1 charted-stat arrival and a post-final correction, all on command.
- **Scenario library (versioned, reused by the League Simulator §4.2):** happy-path week · flexed/moved kickoff · postponed game · mass-inactives Sunday · provider outage (triggers `stats_degraded`, §23.2) · stat correction inside the window · stat correction after the window (flagged, not auto-applied) · charted feed late (Ultra degradation banner) · charted feed revises after posting. Each scenario is the synthetic equivalent of a real §19.2 edge case — deterministic and re-runnable, instead of waiting for a real Sunday to reproduce it.
- **What it proves before a vendor is chosen:** the full Phase D gate (lineups → lock → live scores → corrections → finalize → standings), all v1 scoring templates (v2.7: the 6 parity templates; tracking/charted two-phase settle proven on placeholder keys until Alpha/Ultra are funded), the degradation banners, and the reconciliation job — all end-to-end, all at $0.
- **What it can't prove:** real-world accuracy of any provider's actual numbers, or that provider's real-world uptime/latency under game-day load. Those are validated in order after synthetic passes: `sleeper_free` in beta (real data, no SLA), then the paid tier during the canary cohort (delivery plan M7) before GA.
- **Build order:** ship in M0 alongside the fixture recorder (§23.6 is the "generate," the recorder is the "capture real" — both feed the same replay harness, delivery plan §4.2–4.3).

---

## 24. Observability, Operations & Game-Day Readiness (NEW v2.0)

If draft night breaks, the league leaves. Operate like it.

### 24.1 Golden signals & alerts (Sentry + Supabase logs/reports; dashboard per surface)
| Metric | Target | Page-worthy alert |
|---|---|---|
| Pick/bid RPC latency (p95) | < 300ms server, < 500ms pick→broadcast | > 1s for 2 min |
| Draft-tick lag (now − oldest due deadline) | < 2s | > 10s (a draft is stuck) |
| Scoring lag (ingestion→league broadcast, p95) | < 15s | > 60s during games |
| Realtime quota headroom (connections, msgs/s, joins/s) | < 70% | > 85% |
| Job failures (waivers, finalize, swaps, corrections) | 0 | any (with league_id context) |
| Reconciliation drift | 0 cells | any |
Every worker writes structured logs with `league_id`/`draft_id` so any league's night can be replayed from logs.

### 24.2 Controls
- **Feature flags per league** (`leagues.settings.flags`): canary new engine behavior on staff/friendly leagues first.
- **Kill switches:** pause-all-drafts (auto-pauses live drafts with a banner — the engine's pause semantics make this safe), disable-waiver-runs, freeze-scoring (show last-good scores). Each is an admin action with an ops log.
- **Deploy freeze:** no schema or engine deploys Thu 7pm ET → Tue 6am ET during the NFL season; hotfix path documented (delivery plan).
- **Migrations:** expand → backfill → contract, always additive during season; every migration reversible or explicitly marked one-way with a backup gate. PITR enabled before beta.

### 24.3 Runbooks (written before GA; rehearsed once)
Stuck draft (deadline in past, no tick) · stats provider outage mid-Sunday · realtime degradation (fall back to 10s REST polling — clients already REST-first) · waiver job partial failure (re-run idempotently per league) · "commissioner locked themselves out" (support tooling reads the audit log, never bypasses it) · restore-a-league from PITR without touching other leagues (documented as *possible but last-resort*).

---

## Appendix A — Competitor Comparison

Synthesized from official help docs (ESPN, Yahoo, Sleeper) cross-checked with NFL.com, MyFantasyLeague (MFL), Fleaflicker. Values reflect the 2024–25 products. ⚠ = vendor docs don't state it / conflicting; treated as secondary.

### A.0 Reality check on the named platforms
- **Flock Fantasy** — **not a league host.** It's an analytics/rankings/creator-content companion that *syncs to* your ESPN/Yahoo/Sleeper league (rankings, a read-only league dashboard, trade calculator, practice mock drafts, and a draft-overlay Chrome extension, best-ball leaning). There is no Flock draft engine or league/scoring/commissioner settings to mirror. Useful as content/UX inspiration only.
- **Footballguys** — **not a league host.** It's a research/projections/draft-*assistant* business (Draft Dominator runs alongside a draft hosted elsewhere; "Footballguys Home Leagues" are actually hosted on Sleeper). Great benchmark for draft-prep UX and customizable projections, not for hosting mechanics.
- **Benchmarks that matter:** **Sleeper** (best-in-class draft + the best commissioner transparency), with **ESPN/Yahoo** as the mass-market baseline and **MFL/Fleaflicker** as the deep-customization references.
- **Scoring-category audit (v2.2):** Yahoo's published category list and Fantrax's "extensive list / create your own" both top out at box-score-derived categories (40+-yard-play bonuses are as exotic as it gets). No host — major or niche — exposes air yards, YAC, or yards after contact as scorable. Supports the "first platform with advanced-stat scoring" claim; re-verify immediately before any marketing use.

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

## Appendix B — Scoring Template Catalog (`scoring_systems.rules`) — v2.2

Reuses the existing `scoring_systems.rules JSONB` (see `docs/03-DATA-MODEL.md`). Ship the v1 templates as system rows (`is_template = TRUE`, `owner_id NULL`) — **v2.7: the 6 parity templates at v1; the B.2–B.3 FieldScout rows wait for funded advanced stats.** Decimal supported throughout. **Platform values below are best-known as of July 2026 — re-verify every cell against ESPN/Yahoo/Sleeper official help pages at build time** (⚠ marks the cells most prone to drift: K distances, D/ST tiers).

### B.1 Platform-parity templates — core offense
| Key | ESPN Std | ESPN PPR | Yahoo Std | Yahoo ½PPR | Sleeper Std | Sleeper PPR |
|---|---|---|---|---|---|---|
| `pass_yards` | 0.04 | 0.04 | 0.04 | 0.04 | 0.04 | 0.04 |
| `pass_tds` | 4 | 4 | 4 | 4 | 4 | 4 |
| `interceptions` | **−2** | **−2** | **−1** | **−1** | **−1** | **−1** |
| `pass_2pt` | 2 | 2 | 2 | 2 | 2 | 2 |
| `rush_yards` | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 |
| `rush_tds` | 6 | 6 | 6 | 6 | 6 | 6 |
| `rush_2pt` | 2 | 2 | 2 | 2 | 2 | 2 |
| `receptions` | 0 | **1** | 0 | **0.5** | 0 | **1** |
| `receiving_yards` | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 |
| `receiving_tds` | 6 | 6 | 6 | 6 | 6 | 6 |
| `rec_2pt` | 2 | 2 | 2 | 2 | 2 | 2 |
| `fumbles_lost` | −2 | −2 | −2 | −2 | −2 | −2 |
| `fumble_recovery_td` / `return_td` | 6 | 6 | 6 | 6 | 6 | 6 |

Kicking & D/ST use each platform's own tables (⚠ verify): K distance tiers per B.3 shape; D/ST per B.4 with `dst_model = 'split'` for ESPN templates and `'single'` for Yahoo/Sleeper.

### B.2 FieldScout Alpha — *the catch, re-scored* (`tracking` tier; 100% live)
Replaces flat receiving yardage with a **who-earned-it split**: completed air yards credit the route/target win (shared with the QB throw); YAC is receiver-created and pays **double**. Everything else stays familiar (Sleeper-style base) so only the catch changes.
| Key | Value | Note |
|---|---|---|
| `receptions` | 0.5 | anchor of familiarity |
| `receiving_yards` | **0** | replaced by the split ↓ |
| `receiving_air_yards` | **0.06** | completed air yards only — production, not intended-target opportunity |
| `receiving_yac` | **0.12** | yards after the catch — receiver-created, pays 2× air |
| passing / rushing / TDs / turnovers / K / D/ST | = Sleeper Std | 0.04 · 4 · −1 · 0.1 · 6 · −2 |

League-wide, YAC ≈ half of receiving yards, so expected yardage rate ≈ 0.06(.5) + 0.12(.5) = **0.09/yd** — Half-PPR magnitude, redistributed toward creators. *Worked example: 8 catches, 80 yds (40 air / 40 YAC): Half-PPR = 12.0 · **Alpha = 4 + 2.4 + 4.8 = 11.2**. A screen-game YAC monster with the same line at 10 air / 70 YAC: **Alpha = 13.0.** Same box score, different games, different points — that's the product.*

### B.3 FieldScout Ultra — *every yard credited to who earned it* (`tracking` + `charted`)
Alpha's receiving split, plus the rushing equivalent and a QB pressure signal:
| Key | Value | Note |
|---|---|---|
| receiving | = Alpha | 0.5 / 0.06 air / 0.12 YAC |
| `rush_yards` | **0.06** | the clean yard splits credit with the line |
| `rush_yards_after_contact` | **0.06** | *stacks* on `rush_yards` → a contact yard pays **0.12**, double a clean yard |
| `qb_sack_taken` | **−0.5** | pressure-to-sack is a QB skill; box-score stat, live |
| everything else | = Alpha | |

*Worked example: 20 carries, 100 yds (45 after contact): Standard/PPR = 10.0 · **Ultra = 6.0 + 2.7 = 8.7** — while a 100-yd game with 70 YCO scores **10.2**. The bruiser out-points the untouched-lane runner on identical box scores.* Coefficients are **calibration-pending defaults** (§7.3.3): symmetric and memorable now; the M0-fixture backtest tunes them (expect the rush base to drift toward ~0.07) to hold positional means within ±10% of Half-PPR. `charted` timing/degradation semantics: §23.5. Reserved v1.1 keys: `broken_tackles`, `te_reception_premium` on house templates.

### B.4 Kicking, D/ST & reserved catalog (engine supports; v1 exposure via templates only)
Kicking by distance: `fg_0_39` 3, `fg_40_49` 4, `fg_50_plus` 5, `pat_made` 1, `fg_missed` −1 ⚠, `pat_missed` −1 ⚠. *[v2.8.5: ESPN's verified default table additionally scores FG 60+ = 6 (50–59 = 5) and two D/ST PAT micro-categories (safety on a PAT try +1; return on a PAT try +2) — provider-unobservable on the current tier, so they are **named parity exceptions** per the Q9 ruling (see §7.3.3 erratum + changelog), not catalog keys; lift path is the September F10 feed check.]* D/ST: `def_sack` 1, `def_int` 2, `def_fumble_rec` 2, `def_td` 6, `def_safety` 2, `def_block` 2, `def_return_td` 6; points-allowed single-tier (`def_pa_0` 10 … `def_pa_35_plus` −4) or ESPN split model via `dst_model`. Bonuses (`pass_300_bonus`, `rush_100_bonus`, …), TE premium, and the full IDP set (`idp_*`) remain in the engine catalog for the v1.1 custom-scoring unlock — the calculator ignores keys a snapshot doesn't contain, so templates and future custom systems share one code path.

> **v1 UI is a template picker** (§7.3.3), not an editor: **6 parity cards at v1** (v2.7 — Alpha/Ultra cards and the "same game, scored three ways" widget return when advanced stats are funded) with side-by-side compare. The full editor (this catalog exposed per-category) returns in v1.1. *(v2.11: the 2026 test cohort gets the §7.3.3.1 editor over the `scoring_surface: 'scorable'` subset of this catalog — bonuses, TE premium, and IDP stay reserved.)*

---

## Appendix C — Claude Code Build Prompts

Copy-paste prompts in the style of `docs/05-CLAUDE-CODE-PROMPTS.md`. **Hand Claude Code one task at a time**, in order. Each assumes the repo is open and the prior task is committed.

> **v2.0 note:** these prompts predate v2.0. The delivery plan (`delivery-plan-redraft-leagues.md` §3) extends this task list with the v2.0 work (L.A0 time/stats abstractions, L.D0 schedule engine, L.D4 scoring fan-out, L.D5 locks/pool, L.E2 corrections) and adds the per-task Definition-of-Done checklists every prompt must satisfy. Use the delivery plan's sequence; use these prompts as the style reference.

### Task L.A1 — League foundation: schema + RLS
```
Build the league foundation for FieldScout. Read CLAUDE.md, docs/03-DATA-MODEL.md, and docs/specs/spec-redraft-leagues.md (§12) before starting. This supersedes the thin leagues schema in spec-leagues-live-mode.md.

1. Migration supabase/migrations/0XX_leagues_foundation.sql:
   - RLS helper functions is_league_member(uuid) and is_league_commish(uuid) (SECURITY DEFINER, STABLE) — §12.0
   - ALTER TABLE leagues to add: status, format, team_count CHECK IN (8,10,12,14,16)  -- v1, regular_season_weeks, playoff_teams, playoff_start_week, waiver_type, faab_budget, trade_review, trade_deadline_week, lineup_lock, settings JSONB, deleted_at — §12.1
   - Replace the old "viewable by members" policy with one using is_league_member()
   - CREATE TABLE league_members (role, team_id, is_placeholder, is_autodraft, faab_balance) + RLS + indexes — §12.2
2. Zod schemas in src/types/league.ts for all settings (§7.3) with the documented defaults and ranges; a validateLeagueSettings() util enforcing the cross-field rules in §7.3 "Validation rules".
3. API route handlers (Route Handlers, kebab-case): POST/GET /api/leagues, GET/PATCH/DELETE /api/leagues/[id], POST /api/leagues/[id]/invite, POST /api/leagues/join, member management under /api/leagues/[id]/members — §15.1. League creation and joining are free (v2.8) — no is_pro gate on any of these routes.
4. React Query hooks: src/hooks/use-leagues.ts, use-league.ts, use-league-members.ts.
5. Regenerate types: npx supabase gen types typescript.
Enforce: creator becomes commissioner + gets a team; joining is free; team_count ∈ {8,10,12,14,16}; structural settings editable only in setup/scheduled (else require a commissioner override flag).
```

### Task L.A2 — League create wizard + settings UI
```
Build the league creation wizard and settings UI. Read docs/specs/spec-redraft-leagues.md (§7, §16) and docs/06-DESIGN-SYSTEM.md.

1. src/app/(app)/leagues/page.tsx (My Leagues + Create), /leagues/new/page.tsx (wizard), /leagues/[id]/settings/page.tsx.
2. Components: league-create-wizard.tsx (steps: format → roster slots → scoring → waivers/trades → draft → invite), roster-slot-builder.tsx (per-position starter counts, "Add Custom Flex" via an eligible-position multi-select, bench count, and IR spots each configured Restricted/Unrestricted with eligible designations + min weeks, live roster_size + validation), scoring-template-picker.tsx (6 parity templates per Appendix B/v2.7; compare view; no per-category editing in v1), settings-panel.tsx, invite-panel.tsx (code/link + username/email + seat list, placeholder seats, roles).
3. Use the Zod schemas + defaults from Task L.A1. Mobile-first, dark, shadcn/ui. All ranges/defaults per §7.3.
Acceptance: create an 8/10/12/14/16-team league with valid defaults in <2 min, invite & seat managers, reach status 'scheduled'.
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

1. src/app/(app)/leagues/[id]/draft/page.tsx + components/draft/*: draft-room.tsx (subscribes to draft:<id>; on mount/reconnect FETCH state via REST then subscribe), draft-board-grid.tsx, pick-clock.tsx (countdown from server current_deadline + measured offset; paused state), available-players.tsx (search/filter, Big Board/ADP/tier overlays), my-queue.tsx (@dnd-kit drag), my-roster-tracker.tsx, draft-chat.tsx, presence-bar.tsx (Supabase Presence), mock-draft-launcher.tsx + a persistent MOCK banner state in draft-room.tsx (§8.8: seat picker, CPU speed toggle, recap view; CPU opponents reuse the autopick/bot logic).
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
Build in-season play. Read docs/specs/spec-redraft-leagues.md (§11, §12.7–12.8, §12.13, §14) and reuse Live Mode patterns (spec-leagues-live-mode.md); scoring uses the §7.3.3 generic calculator in src/lib/leagues/scoring/ (built in M1, L.A1.8) against the league scoring snapshot — never the legacy src/lib/scoring/default.ts (research surfaces only; erratum v2.7.1).

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

Draft-order reveal animation, notifications wiring (league_invite, trade_proposal, commissioner action, waiver result), History Mode tab, optional hash-chain tamper-evidence on commissioner_actions (prev_hash/row_hash), auto-sub inactives (opt-in), public league SEO page. Then: Playwright E2E for full snake draft, full auction, disconnect/reconnect, commissioner overrides, a scored week, waiver run, and a trade; a 14-team concurrency load test of the draft room; run the design:accessibility-review and a security-review of the RLS/RPC surface. Fix what they find.
```

---

## Changelog
- **v2.12.4 (2026-08-18):** **§12.5's `voided_at` enumeration gains its third situation — a RESET ends its run's bid history (L.C1.5 batch-6, R379; the fold-back rule; Builder-carriable — it prints a mechanism, it rules nothing new).** v2.12.2 said `voided_at IS NOT NULL` marks a bid row as no longer belonging to the live-or-future nomination at its `nomination_seq`, and enumerated the two situations that make a sequence number ambiguous: cleared-without-an-award (`draft_cancel_nomination`, `draft_end`) and rewound-onto (`draft_undo`). **A third was missing and it is the widest of the three:** `draft_reset` rewinds `current_pick_number` to 1 and §8.5's start re-issues every number from there, so the WHOLE of a previous run's history sits at sequence numbers the next run uses again — ambiguity ACROSS runs rather than within one. Migration 087's `draft_reset` now stamps its run's rows (rows are KEPT — §12.5 stays append-only, the same posture as the `draft_picks` soft-undo it sits beside), the erratum comment beside the column prints all three, and the one reader that must see voided rows (the undo's on-clock recovery, which reads the opening-bid row to learn who nominated) additionally scopes by `drafts.started_at`, because `voided_at` cannot discriminate for it. **Nothing about §8.7's semantics moves** — a reset was always "back to pre-draft"; what changes is that the bid table now says so. Pinned in pgTAP 036 §K both ways (the sweep, and a rewind that lands on the current run's nominator rather than the previous run's).
- **v2.12.3 (2026-08-18):** **§8.6.7's C33 erratum keeps its FIX and loses its REASON — the roster-construction ruling (PROGRESS D163; L.C1.5 batch-5, R374; the fold-back rule).** Chris ruled in session on 2026-08-18 that **roster construction is not enforced from the draft**: a user may draft 16 WRs and solve it in free agency, the draft never consults positional legality, **capacity is a pure count** (`open_slots = total_rounds − picks`, migration 084) and positional slots are a weekly lineup concern — drafting only RB/WR and picking up a QB/K/DST/TE once the season starts is a legitimate strategy. The one asymmetry: **whenever AUTODRAFT is picking or nominating it should fill the roster's remaining HOLES with the final picks rather than add positional depth** — which is exactly the FORCED arm the engine already implements (`v_forced := v_remaining <= v_unfilled`, migration 086; the K/D-ST boundary pinned one unit either side in pgTAP 035 §G). **Consequence for the spec:** v2.12.1's C33 entry argued that §8.6.7 (e) "can select a player the nominator cannot roster" and that (b) would then award an **illegal** pick. Under this ruling that is not a legality problem at all — rotation-skip (c) already guarantees the nominator an open slot, and any player fits a count. **The erratum's fix stands** (the system nomination runs the nominator's own §8.4 chain) but its stated reason is replaced: the reason is **"so an absent manager gets a player their own board would have picked"**, not "so the award is legal". **No product behaviour changes, no engine change, no catalog field moves** — this entry corrects an argument, which matters because a wrong reason attached to a right fix is how a later session justifies the wrong change. §8.6.7's parenthetical is amended in place. **Numbering:** **v2.11 stays reserved for the in-flight scoring-editor entry on PR #152** (first-filed keeps its number — R312/D144(6)).
- **v2.12.2 (2026-08-18):** **§12.5 gains `draft_bids.voided_at` — the schema representation §8.7's "open bids voided" never had (L.C1.5/migration 087; the fold-back rule; routed here by tasks-M3 R363, decided as D162).** §8.7's v2.10 ruling says a cancelled nomination's open bids are voided and that the sequence number is NOT consumed; both were true in prose and neither was expressible in the schema, because `draft_bids` is append-only with no UPDATE or DELETE policy for anyone (§12.5, D131(2)) — so "voided" meant that nothing was written and nothing was removed, and one `nomination_seq` could carry two successive nominations' rows for every reader keyed on it. The nullable `voided_at` names the fact. **No product behaviour changes and no ruling is reversed:** the rows still stand (nothing is deleted), no role gains a write path (the stamp is written only by SECURITY DEFINER verbs, and the client-facing per-role write matrix is re-proven after the column lands), and the sequence number is still not consumed. The column's meaning is mechanical — see the §12.5 note — and its one behavioural consequence is that the auction award's attribution lookup filters on it, so it is correct by its `WHERE` clause rather than by an `ORDER BY` tiebreak over `gen_random_uuid()`. **Numbering:** **v2.11 stays reserved for the in-flight scoring-editor entry on PR #152** (first-filed keeps its number — R312/D144(6)).
- **v2.12.1 (2026-08-18):** **Auction-timeout errata from L.C1.4/migration 086 (the fold-back rule; Builder-carriable per tasks-M3 C32/C33).** **(1) §8.6.2 step 2 — the "or skips per setting" clause names a setting that does not exist** in §7.3.8 and never has (C32). v1 always system-nominates on timeout; the erratum prints the mechanism the engine implements — the on-clock team's own §8.4 resolution chain at an opening bid of `auction_min_bid`, written as a `draft_bids` row (§12.5's uniform history), with §8.4's **K/D-ST deferral mapped to its FORCED-only arm** because an auction has no rounds for the "final 3 rounds" escape to refer to, and with **§8.5.5's disconnect contract carried to the nomination clock unchanged** (autodraft/no-user/fresh nominate at the deadline; a stale seat is held to deadline + `disconnect_grace_seconds`, manual nomination still open during the hold). **(2) §8.6.7 (e) vs (b) reconciled** (C33): (e) as printed can select a player the nominator cannot roster, which (b) then awards to that nominator — a contradiction at the one instant both rules apply. The system nomination runs the **nominator's own** resolve chain, so (e)'s "fits *some* team's open slot" is satisfied a fortiori and (b) is always legal; one implementation covers snake timeouts and auction nominations. No product behavior changes and no catalog field moves — both entries print what the printed text could not be read to mean. **Numbering:** **v2.11 stays reserved for the in-flight scoring-editor entry on PR #152** (first-filed keeps its number — the R312 principle, D144(6)); this entry sits above the merged v2.12 rather than claiming a gap, and the version header moves with it, so a branch that merges after #152 resolves the header conflict deliberately.
- **v2.12 (2026-08-17):** **DRAFT ROOM REDESIGN — the room becomes a full-screen experience with a commissioner command bar and a bottom dock (Chris, in-session 2026-08-17; folded by the Architect per the fold-back rule — PR open for approval).** M2 shipped the room inside the app shell with a page header, a right-hand rail of stacked panels, and a floating commissioner button; Chris has now used it live and ruled the layout over. **(1) §16.1 — the route stands alone:** `…/leagues/[id]/draft` renders with **no left nav, no right context rail, no app header**, while keeping the app's auth + username gates (the guard moves above the shell so one code path gates both worlds). **Cold-load correctness is an explicit acceptance criterion** — click-through, deep link, refresh mid-draft and new-tab entry are all server-rendered cold starts. **Entry is platform-split:** desktop opens a **new browser tab**, mobile opens **in place**. **Draft notifications route to the app home's Join Draft CTA, never to `/draft`** — one entry point, so one place applies the split. **Scope of the chrome-free treatment (ruled 2026-08-17 — the reason, not just the boundary):** a live draft needs every pixel, so app chrome mid-draft is space taken from a draft surface (*"you need all the space you have for the draft surfaces"* — ESPN/Yahoo/Sleeper all do this). The **lobby** shares the route and is part of that live surface, so it is chrome-free too; the **recap** is not a draft surface but a post-draft reading page, so it **stays inside the shell**. **(2) §16.4 — the layout contract, three zones:** a **54px full-width ink command bar** (commissioner: Pause/Resume + `Draft Options`; everyone else: the draft's status in words; **Exit Draft top-right for BOTH**, because everyone must be able to leave — it navigates in place, never closes the tab, never confirms, and **never sets `is_autodraft`**: leaving stops the heartbeat, so the D102 away path autopicks for you until you return, and the copy says so (ruled 2026-08-17); on a mock it carries the MOCK identity and the launcher's practice controls), then **one status strip** (LIVE/PAUSED, Round & Pick, order, presence, clock) with **"You're on the clock" moved to the strip's LEFT edge** and the countdown at its right — the two ends reading *whose turn* and *how long*; then the **full-width draft board**. The **"Draft Room" page header is gone**. Available players / Targets / Roster / Lists / Chat move into a **bottom dock**: tabs across the bottom whose panels slide up **over** the board (never resizing it), closed by default, one at a time, Escape to close. **(3) §16.4 — the v2.0 mobile-density rule is RECONCILED, not duplicated:** the ticker + "my picks" rail + full-grid-one-tap stands for the *board zone*; the M2 four-way mobile pane switcher is replaced by the same dock desktop uses, so there is one pattern instead of two — and since the room sits outside the app shell, the global bottom navigation is absent and the dock owns the bottom edge. **(4) §8.7 — `Draft Options` absorbs the ENTIRE commissioner panel** (timers *plus* undo, cascade undo, reassign/move, force pick, edit order, autopick, seat controls, Manual Edit Mode, Reset, End Draft); the separate floating "Commish panel" button is **retired**; Pause/Resume stay as first-class bar buttons because they are what a commissioner reaches for while something is going wrong. Control semantics, refusals, audit obligations and system posts are untouched — this entry moves the door, not what is behind it. **(5) §9.3 — the two-tabs guard** (RULED 2026-08-17), created by the new-tab ruling: the newest tab of a draft holds the connection, older tabs release it (unsubscribe, stop the heartbeat, offer takeover), coordinated per browser profile via `BroadcastChannel`; the server stays authoritative, so the guard is a courtesy over a correctness boundary and never a substitute for one. **(6) §16.3 — two new UX principles:** *the board is the room* (chrome is shallow and fixed; working panels are summoned, not resident) and *say a thing once* (a permanent status bar means paused/mock/reconnecting are announced in exactly one place — the M2 pause overlay's duplicate copy retires); plus the accessibility note that the dock is a **non-modal** drawer (no focus trap, nothing `inert`, Escape closes, focus returns to its tab). **(7) §16.5.2/§16.5.4** updated for both rows and the banner catalog. **Sequencing (ruled):** the redesign runs **AHEAD of the auction UI** so the auction room is built into the new shell rather than the old one — the M3 *engine* lane continues in parallel; companion breakdown `docs/specs/tasks-DR-draft-room-redesign.md` (prefix `DR.`), and tasks-M3 L.C3.1/L.C3.2/L.C3.3 are amended in the same PR so the auction Builders inherit the new reality instead of a stale plan. **Numbering:** this entry takes **v2.12**, leaving **v2.11 reserved for the in-flight scoring-editor entry on PR #152** (first-filed keeps its number — the R312 principle); both branches edit the version header, so whichever merges second resolves a git conflict deliberately and renumbers above the other, exactly as D144(6) anticipated. **Rulings folded in place 2026-08-17 (no version bump — this entry is the record):** the three questions this fold filed — **Q12** chrome-free scope, **Q13** Exit Draft, **Q14** the two-tabs guard — were all ruled by Chris the same day and are amended into §16.1, §16.4 zone 1 and §9.3 above; PROGRESS §3 carries his words and the reasoning. Nothing in the redesign lane is open.
- **v2.11 (2026-08-16):** **Custom scoring editor un-punted for the 2026 test cohort (C37 ruling, Chris 2026-08-15; the separate parallel Architect track — delivery-plan v1.4's required spec changelog entry, satisfied here; NEW §7.3.3.1).** Partial reversal of v2.7's templates-only cut, for the invite-only cohort ONLY — GA default posture stays templates-only until the editor's gate passes. **Product shape (Chris's requirements verbatim in tasks-M3-auction.md §9 C37):** scoring configured BY POSITION (stepper, not global categories); an "All Positions" switch per section with per-position customization after; five sections (Rushing/Passing/Receiving/Special Teams/Turnovers) for every position except K and D/ST; a live fixed sample player per position — Dan Marino (QB), Randy Moss (WR), Adrian Peterson (RB), Gronk (TE) — recomputing through the REAL calculator. **Data model:** `rules` gains a versioned **format-2 base + per-position-override envelope**; effective rules = `{...base, ...positions[P]}` via a pure resolver in front of the untouched D33/D57 dot-product calculator; flat maps stay format 1 and valid forever (resolver ≡ identity, property-pinned) — **zero scored-outcome change for existing template leagues**; templates byte-identical; the All-Positions switch is derived state (normal-form strip at save). **Entry point:** the picker's "Customize" forks a template into a commissioner-owned `scoring_systems` row (`is_template = FALSE`); personal pre-existing systems stay unattachable (D33 one-namespace). **F21 closed as validation law:** scorable-allowlist via the new §23.5 `scoring_surface` registry field (raw sources + aggregates inexpressible), doc-wide PA/YA **bucketization-set exclusivity** (the double-pay itself), position-scoped overrides, |coef| ≤ 100 at 2dp, normal form — enforced server-side at write/attach AND at draft start (an invalid doc can never reach `scoring_rules_snapshot`; §7.3.8 bullet extended). **Snapshot law unchanged:** editor is a `setup`/`scheduled` surface; the doc freezes verbatim at draft start; post-draft changes stay the commissioner-override law, not exposed in the cohort editor. **Free for everyone** (Pro suspension). **Amendment sites:** §7.3.3 v1-scope bullet + NEW §7.3.3.1 · §7.3.8 validation · NEW §12.25 (member SELECT policy + RPC law; no new columns) · §16.2 (`scoring-editor.tsx` + ops; picker gains Customize) · §16.5.5 carve-out · §23.5 (`scoring_surface` + bucket-set definitions) · Appendix B.4 note. **Q12/Q13 RULED by Chris in-session 2026-08-16, folded here (PROGRESS §3 Resolved).** **Q12 — K and D/ST ARE editable**, one single-section page each; sample players are named, joining the offensive four: **Neil Rackers (K)** and **the Seahawks (D/ST)**, lines pinned in §7.3.3.1. **Q13 — ship `return_td`, add `return_yards` when a source is found** — written as a 4-step checklist (adapter mapping → one registry entry → un-gate the catalog field → done; no migration, no engine change) so "easily" is a property of the design, not a hope. **Defense-tier corrections + rulings (same session):** an earlier draft wrongly implied points-allowed and yards-allowed are alternatives to choose between — **they are independent tables that pay additively**; what differs between families is where the tiers are **cut** (ESPN 14–17/18–27/35–45/46+ vs shared 14–20/21–27/35+; ESPN additionally pays a YA table — the D44 `dst_model` distinction). **(2a)** the format therefore reserves **`tier_cuts` now** — per-league boundaries can only live in the league's own doc, so adding them later would force a third format version plus a migration of every stored doc and a re-proof of every frozen snapshot; **tier keys are generated from the cut list, verified to regenerate all three of today's families byte-exactly** (pin it — that equivalence is the backward-compat argument). **(2b)** first-version UI **inherits** boundaries from the starting template and does **not** edit them (no preset dropdown, no boundary fields) — the commissioner edits **what each tier pays**; boundary editing is **ledger row F59**, routed to a follow-up breakdown. **(3)** when F59 builds, boundaries are entered as **ascending cut points, never ranges**, so overlapping tiers and coverage gaps are structurally unconstructible (residual validation: ascending, integers, ≥2 cuts; the two tables independent). **Build NOT authorized by this entry:** a follow-up Architect breakdown (after Chris approves) cuts the tasks; separate parallel track, never an M3 lane.
- **v2.10.3 (2026-08-17):** **§8.2 soft-timer erratum from L.C1.2/migration 084 (the fold-back rule; Builder-carriable).** The "`pick_timer_seconds = 0` ⇒ no auto-action, informational clock only" bullet is scoped explicitly to the snake/linear PICK clock: an auction reads `auction_nomination_seconds`/`auction_bid_seconds`, neither of which admits 0, so `draft_start`'s auction arm sets a nomination deadline regardless of the pick timer and the tick keeps enforcing it. No behavior anywhere else changes; the catalog (§7.3.8) is untouched. Recorded because the printed bullet, read literally, said the opposite for auctions.
- **v2.10.2 (2026-08-16):** **Schema errata from L.C1.1/migration 083 (the fold-back rule; Builder-carriable per tasks-M3 C39/D127).** **(1) §12.5 `draft_bids.action_id` → NULLABLE with a PARTIAL idempotency unique** (`uniq_draft_bid_action … WHERE action_id IS NOT NULL` replaces the printed inline `UNIQUE(draft_id, action_id)`): system rows — the tick's opening bid on a system nomination (D129(2)/D130) — have no client action; the printed `NOT NULL` would make every system nomination unrecordable while the partial unique still dedupes every client retry (E2). The 065 `uniq_draft_action` precedent exactly (tasks-M3 C39). **(2) §12.3 `drafts` gains `budget_adjustments JSONB NOT NULL DEFAULT '{}'`** (team_id → integer delta): D127 keeps budgets DERIVED — never stored counters — but the §8.7 "Adjust auction budget" control needs its one stored input; validated per E28 at edit time, room-visible via the D134 payload extension, cleared by `draft_reset` (R302). Spec-absent schema recorded per the D102 precedent. Both shipped in migration 083 with pgTAP 032 pins (partial-unique proven directly; NULL-coexistence; CHECK boundaries `amount >= 0` / `nomination_seq >= 1` — the R43 lesson at creation).
- **v2.10.1 (2026-08-16):** **The three v2.10 open items RULED (Chris, in-session).** **(1) End the draft (OQ 19 → ruled):** option (a) — end-as-is: drafted players keep prices, unfilled slots stay empty, league → `in_season`, free agency fills later; the §8.7 row now prints the behavior and the control is a BUILT M3 deliverable (tasks-M3 C41; RPC in L.C1.5, UI in L.C3.2; the completion writer accepts partial rosters; solvency trivially preserved). **(2) DND × autopick (OQ 20 → ruled): DISPLAY-ONLY — the skip recommendation was offered and explicitly declined** (recorded in OQ 20 and §12.24 so it is never re-proposed as an oversight); the engine never reads `draft_dnd_marks`. **(3) Projections-splits sync (C43 → ruled):** a standalone small data task authorized to run IN PARALLEL with the M3 build, never a dependency; L.C3.3's split columns stay code-gated and light up when both land (§16.4 note updated).
- **v2.10 (2026-08-15):** **Auction-UI product rulings (Chris, in-session 2026-08-15; folded by the M3 Architect per the fold-back rule — PR #150).** **(1) Auction room layout** (§16.4 callout): per-team columns ordered by nomination order (drafted players w/ prices, positions remaining, spots left, remaining budget, max bid); at-a-glance identification of my team / the nominating team / the latest bidder; nomination centerpiece unchanged. **(2) Auction player table** (§16.2 `auction-player-table.tsx` + §16.4): expandable, Show-Drafted toggle, projection/cost columns incl. `players.auction_value`, derived $-per-point and weekly average, bye + SOS, stat-split columns *(gated on a projections-sync extension — the blob is points-only today; tasks-M3 C43)*, position/search/Favorites filters, column customization + reset, row actions Add-to-Targets / Nominate / Do-Not-Draft. **(3) Do-Not-Draft marks** (§12.24 `draft_dnd_marks`, NEW): per-user per-draft, own-rows client-writable (the `draft_queues` precedent), never broadcast; autopick interaction = OQ 20. **(4) "Targets" naming rule** (§8.4): the queue is surfaced as **Targets** in all UI; schema/API names unchanged. **(5) Auction commissioner UX** (§8.7): **pause-first REQUIRED** for undo, Manual Edit Mode, current-nomination edits, and timer edits (supersedes controls-available-live FOR AUCTION; snake divergence recorded, alignment a follow-up row); **Manual Edit Mode** replaces the drag articulation (reset-pick-with-refund / move-with-re-entered-cost modal over the reverse-won-bid + priced-reassign paths); **edit current nomination** = cancel-and-renominate while paused; **End draft** control added with semantics OPEN (OQ 19 — do not build until ruled). Companion: tasks-M3-auction.md amendments (L.C1.1/L.C1.5/L.C3.1/L.C3.2 + new L.C3.3), C41–C43.
- **v2.9.2 (2026-08-13):** §7.3.8 catalog completion — **`draft.time_zone`** (M2 task L.B3.4; the fold-back rule; PROGRESS D98/C27). §16.4 requires a league reference timezone ("viewer-local with league TZ on hover") and the F38 ledger row routes "the named per-league IANA draft zone" to the draft-setup surface, but no catalog field existed anywhere — §7.3.8 stored only the offset-ISO `draft_scheduled_at` instant. Added **additively**: `time_zone` (valid IANA zone name, nullable, default null) in the §7.3.8 table. **Display-only metadata** — instants stay the authority for every deadline; when set, league-time renders in the named zone via Intl, when null the M1 stored-offset render stands, so no stored league changes behavior until its commissioner picks a zone. The draft-setup surface offers the scheduler's own zone as the one-tap default. Not a product change — §16.4 always required the zone; only the storage was unprinted.
- **v2.9.1 (2026-08-07):** **`profiles.display_name` is DROPPED — migration 077**, the "separate, later change" v2.9 deferred. v2.9 kept the column as an inert NULL so the 075 deploy was order-independent against the running site; the hosted-migration reconciliation (production and the repo now in sync at 076, history clean) removed that constraint, and the column is dead weight. 077 is the **highest-numbered** migration by requirement: thirteen earlier migrations read or write the column, so a fresh `supabase db reset` only replays cleanly while the drop is last — nothing may be numbered after it that touches the column. **This reverses v2.9's "the league RPCs are deliberately not re-pointed."** That reasoning was sound while the column existed and was permanently NULL; once it is gone the same five functions — `notify_list_followers`, `create_league`, `seat_league_member_internal`, `get_join_preview`, `draft_actor_name` — would break at RUNTIME on the next call, because Postgres records no dependency from a function body to a column and the drop therefore would not block. 077 re-points all five FIRST, in the same transaction as the drop, from production's LIVE `pg_get_functiondef` output rather than the repo's migration files; the only edit is removing the `display_name` term from each `COALESCE` so it resolves to `username`. Signature, volatility, SECURITY DEFINER/INVOKER, `search_path` pin, grants and surrounding logic are unchanged, and `CREATE OR REPLACE` preserves the ACL (038's `REVOKE EXECUTE … FROM PUBLIC, anon` on `notify_list_followers` survives). No observable behaviour change: every row's `display_name` was already NULL, so each chain already fell through to the handle. `get_join_preview` and `draft_actor_name` still render the BARE handle, `notify_list_followers` still renders `@handle` — the v2.9 D115(4) corollary stands. F2 untouched. `ai_personas.display_name` and `expert_profiles.display_name` are untouched — an AI persona's public parody brand name and a dead legacy table, neither a person's name. Pinned in new pgTAP **027** (universal `pg_proc.prosrc` sweep, so a future function or a `CREATE OR REPLACE` hotfix that reintroduces the read fails loudly), 005's R31 slot (now `hasnt_column`), and the `migration 077` block in `src/lib/identity-render.test.ts`. pgTAP 023's actor-name fixtures and message pins move from planted display names to the users' handles — the fixture `UPDATE`s would no longer parse.
- **v2.9 (2026-08-05):** **The identity ruling — FieldScout stores no name for a person.** Chris, verbatim: *"we don't need either a display name or a full name. we just need the email, password and unique username."* Ruled after seeing his own real name rendered across the app: `handle_new_user` seeded `profiles.display_name` from the OAuth `full_name` claim, so signing in with Google wrote a REAL NAME into a row that the `profiles` policy "Profiles are viewable by everyone" USING (true) exposes to **anon** — and every identity surface rendered `display_name ?? @username`. **Resolution:** the name is not stored at all. Migration **075** replaces `handle_new_user` so the profile INSERT writes only `(id, username, avatar_url)`, and clears the names already stored (`UPDATE profiles SET display_name = NULL`). Every identity render is the **@username** and nothing else: §7.2's identity table and render rule, §7.2.1's retained-history line, §12.23's claim-preview comment, and §16.4's growth-loop rule are updated in place. Account settings has **no name field** — email, password and the read-only permanent handle. *(Supersedes an earlier same-day attempt that renamed the column to `profiles.full_name` and called it private: the world-readable policy made "private" untrue, and the rename could not be deployed in either order against the running site. 075 makes **no schema change** for exactly that reason — `profiles.display_name` is NULLABLE with no default, so once nothing writes it the column sits inert and the app deploy and the migration are order-independent. Dropping it is a separate, later change.)* The league RPCs are deliberately **not** re-pointed: `create_league` / `seat_league_member_internal` / `get_join_preview` / `draft_actor_name` / `notify_list_followers` all read the column through a `COALESCE` onto `username`, so with it permanently NULL they already resolve to the handle. F2 is untouched: the claim preview still exposes exactly three fields and never `invited_email`. AI personas are **unaffected** — `ai_personas.display_name` is NOT NULL PUBLIC brand copy for a fictional analyst ("Bathew Merry (AI)", the §4.6 transparency marker), not a person's name, and keeps rendering under its existing column name; no persona schema churn. Pinned in `src/lib/identity-render.test.ts` (source-level sweep of every surface + the migration's shape) and pgTAP 005's R31 slot, which now asserts the trigger writes **no** name. *(Search also narrows to handle-only matching — there is nothing else left to match on.)*
- **v2.8.17 (2026-08-05):** §15.2 commissioner-route completion (M2 task L.B2.3 — the fold-back rule; PROGRESS D114). The printed route list carried every §8.7 control except a route for "Adjust pick clock" (E15) — added `POST /api/leagues/[id]/draft/clock` → `draft_set_clock` as a **dedicated verb**, the Builder-finalized choice within the task's printed latitude ("fold into PATCH draft or a dedicated verb"): the draft PATCH stays the config/order surface (and post-start carries the E31 order dispatch), while the clock edit is a live control shaped like its §15.2 siblings. Not a product change — the §8.7 control was always in scope; only the route path was unprinted. *(Same PR housekeeping: the header version line, stale at 2.8.15 since the v2.8.16 changelog entry landed, is synced to the changelog.)*
- **v2.8.16 (2026-08-04):** §8.8 Mock Draft Mode build-mechanics erratum (M2 task L.B1.6, migration 071 + in-place amendments to 065/066/068/069 — the fold-back rule; PROGRESS D103/D110). Four decided mechanics folded into the LAW: **(1)** `drafts.config.mock` carries a third key, **`launched_by`** (the launcher's user id) — D103(2)'s authorization key: in a mock the only legal human caller of pick/pause/resume/delete is the launcher, keyed on this value (never on seat ownership — "any seat selectable" means the chosen seat may be a placeholder or another member's franchise); still no schema change. **(2)** The launcher-only control surface: `draft_pause`/`draft_resume` gain a mock-launcher arm (the §8.8 "pause/leave anytime … resumable" lifecycle needs a resume path that cannot dead-end on a non-commissioner launcher; commissioners have no bypass), and every other §8.7 control **refuses mocks** — §8.7 is the real-draft surface, and an unguarded `draft_reset` on a mock was a live-proven zero-side-effect breach (it wrote `leagues.status` + removed the stored schedule instant). **(3)** The E59 auto-pause threshold: a live mock pauses when the LAUNCHER's `draft_liveness` beat is stale past `disconnect_grace_seconds` + one tick (D93's recorded contract) — always preempting the §8.5.5 grace-hold's deadline+grace autopick, so a disconnected human never loses a pick to a timeout; resume is the launcher's action (never the tick's). **(4)** The 72h expiry's *idle* definition: idle_since = GREATEST(`drafts.updated_at`, the launcher's last heartbeat) — either engine activity or human presence resets the clock (the conservative deletion posture); deleting a mock (owner or expiry) explicitly removes its `league_chat` `draft:<mock_id>` rows (the chat FK is to the league, so CASCADE cannot reach them — leaving them would strand a member-visible ghost context against E59's "zero league impact"). Not a product change — §8.8's printed behavior made implementable as stated; pinned in pgTAP 025. *(Erratum completed 2026-08-04, M2 batch 7 R149 — no version bump: `config.mock` carries an optional fourth key, `action_id`, the launch-idempotency key (one UUID per client submit; a replayed submit returns the original mock — launcher-scoped, never cross-user; absent when the caller sends none). Same-batch attestation note: the §8.8 site's printed shape updated in place.)*
- **v2.8.15 (2026-08-04):** §12.14 rewritten (M2 task L.B1.5, migration 070 — the D89 erratum applied at its build site, the fold-back rule; flagged for Chris's read in the tasks-M2 breakdown PR per D89 and again in the 070 PR). The printed `supabase_realtime` publication ALTER ("so Postgres Changes broadcast") was v1.x text superseded by §9's v2.0 transport rule: `realtime.broadcast_changes()`/`realtime.send()` write to `realtime.messages` and need no publication membership, and executing the ALTER would only re-enable the Postgres Changes anti-pattern the §8.4 checklist bans. §12.14 is now the Broadcast-from-DB **trigger inventory** (per-table events/topics/shipping migration, the never-broadcast list, the §9.1 heartbeat vehicle, and the channel-auth summary — member SELECT per topic family + presence-only INSERT). Not a product change — the §9.2 pattern made canonical where the old section contradicted it; pgTAP 024 pins the publication carries none of the tables (D89 falsifiable). *(2026-08-04, same erratum, no version bump — R145, M2 batch 6: the rewritten M4+ row completed with `team_week_results`, which §9's mechanism table and §9.1 both name as a trigger table.)*
- **v2.8.14 (2026-08-04):** §8.7 outage-arm erratum (M2 task L.B1.4, migrations 068 amended/069 — the fold-back rule; PROGRESS D102/D108). The commissioner-outage auto-pause's mechanism folded into the robustness bullet: detection reads `draft_liveness` (the v2.8.13 heartbeat table), threshold = the 45s freshness constant + `disconnect_grace_seconds`, evaluated **as-of-now** each tick (deliberate contrast with the pick hold's as-of-deadline rule, R132 — the outage check is a continuous supervision question, not a classification of a fixed past instant); auto-pause requires supervision to have been **established** (≥ 1 commissioner/co-commissioner heartbeat row) — a never-attended draft is D94's unattended autopilot and runs by design ("disconnects" presupposes a connection); the pause rides the one §8.7 v2.0 bookkeeping implementation and posts a system chat message; resume is always a commissioner action (no auto-resume on reconnect). Not a product change — the printed bullet's behavior made implementable as stated, reconciled with D94/E48.
- **v2.8.13 (2026-08-04):** The authoritative-clock errata (M2 task L.B1.3, migration 068 — the fold-back rule; PROGRESS D87/D102/D107). **(1) The `draft-tick` vehicle (§8.2/§14/§22.3; tasks-M2 C21/D87):** implemented as an in-database SQL RPC (`draft_tick()`) scheduled directly by pg_cron every 5s — no Edge Function, no HTTP hop (the repo has zero Edge Functions; its Vercel-cron floor is 60s). The "immediate self-schedule after each action" is satisfied in-database (action RPCs set the next deadline synchronously; the ≤5s cron enforces expiry — worst-case timeout lag ~5s); pg_net self-invocation is the recorded escape hatch. The tick also carries the D94 auto-start scan (a `scheduled` league whose `draft_scheduled_at` passed is created-if-absent and started each tick — the settings-only scheduling path can never dead-end). **(2) The disconnect-grace mechanism (§8.5.5; D102 — spec-absent schema):** `draft_liveness(draft_id, user_id, last_seen_at)` + the `draft_touch` heartbeat RPC (~15s room cadence; its own table so heartbeats never contend with the draft-row lock; no client DML/SELECT/broadcast; FRESH = ≤ 2 missed beats, 45s pinned). At deadline expiry autodraft/no-user/FRESH seats autopick immediately (§8.5.4); a STALE seat's pick holds open to deadline + `disconnect_grace_seconds` with manual picks allowed during the hold (E3), then autopicks. Neither is a product change — both make §8.2/§8.5's printed behavior implementable as stated. *(2026-08-04, R133 — M2 batch 4: the §22.3 "immediate self-invocation" restatement gained the same erratum marker; a fold-back site missed in the original pass. Same erratum, no version bump.)*
- **v2.8.12 (2026-08-03):** §12.15 erratum (M2 task L.B4.1, migration 067 — the fold-back rule; PROGRESS D106). Two mechanical completions of the printed DDL, neither a product change: **(1)** the shared-private read note ships for `lists` AND `list_players` — the note printed only the `lists` policy, but its own stated purpose ("let members **open** a list that is shared but private") is unreachable without the list's rows, because 001's `list_players` policy re-states list visibility inline and therefore does not follow the new `lists` policy automatically; both additive policies carry `deleted_at IS NULL` (a soft-deleted list is owner-readable only, mirroring 001's public arm), and the four existing 001 lists/list_players policies are untouched. **(2)** §12.15's `owner_id` comment ("matches lists.owner_id") becomes a constraint (the R43 comment-becomes-constraint class): a composite FK `(list_id, owner_id) → lists(id, owner_id)` backed by a `UNIQUE (id, owner_id)` on `lists` — without it the printed owner-scoped FOR ALL let a member attach ANOTHER user's private list under their own `owner_id` and force-share it to the whole league (a privacy hole; 23503 now on every path). Defense in depth recorded: the new policies' EXISTS subqueries run under `league_lists`'s own RLS, so a non-shared content leak requires BOTH layers to loosen (probed live both directions — pgTAP 021). No route/UI contract change; §15.5 unchanged.
- **v2.8.11 (2026-08-03):** §8.5.3 erratum (M2 batch-2 review R124; the fold-back rule — the D13/D33 erratum class). §8.5 step 3's "fits roster" at MANUAL pick time means **capacity only**: a manual snake pick needs no per-position slot-fit validation, because the advance math guarantees each team exactly `total_rounds` picks and rounds = draftable spots (D91 — starters + bench, IR excluded). Need-fit ("best available that fills a need") is §8.4 **autopick's** rule, and E16's overlapping-flex bipartite slot-fit belongs to **M4's lineup validator** (tasks-M2 §1's E16 routing). This reading was recorded at build time in PROGRESS D105(7); named here in the LAW so M4 doesn't re-read the clause as a missing pick-time check. No behavior change — migration 066 shipped this reading.
- **v2.8.10 (2026-07-26):** §7.2/§16.5.2/E65 erratum (M1 task L.A2.6, the `/join/[token]` claim page — PROGRESS D80, ledger F29; the fold-back rule). The v2.6 identity design had the fresh-signup form **pre-fill and lock** the email field to `invited_email` (E65, §7.2 path 2), removing the mismatch failure mode for the common case. The later v2.7.1/D48 growth-loop posture pinned the pre-auth preview (`get_join_preview`) to expose ONLY league name + team label + inviter display name — never `invited_email` (F2, pgTAP-enforced) — which makes the pre-fill **unprovidable on the only pre-auth surface**: an anonymous visitor's claim page cannot learn the invited email to render it. **Resolution (F2 is inviolable):** the claim page does NOT pre-fill or display the address; it directs the visitor to sign up/in with the account the invite was sent to, and `claim_league_invite`'s server-side email check (case-insensitive JWT-email vs `invited_email`, E53) is the gate — a wrong account yields the friendly mismatch screen with the invite intact (no writes on refusal). Correctness never depended on the pre-fill; the "lock" was a convenience F2 makes impossible to provide safely to an unauthenticated visitor. §7.2 path 2 and E65 updated; the growth-loop funnel (§16.4) is unaffected (the funnel measures the same steps). A masked-hint or any client-visible disclosure would need a separate ruling amending F2 — not taken. No behaviour change vs. what shipped; this names the reconciliation in the LAW so it is not re-litigated.
- **v2.8.9 (2026-07-26):** §7.2.1 erratum (M1 batch-16 remediation, PROGRESS Q11 ruled by Chris — the fold-back rule): the **voluntary-leave notification** on `leave_league` (migration 063) notifies **both** the departing user **and** the sitting commissioner. §7.2.1:190's "removed / left / franchise retired" categories already covered the departing user under reading (a) — now authoritative — so the departing-user notification is a spec-required fix; the commissioner-too notification the shipped code already sent was **spec-silent** (§7.2.1 names no commissioner recipient anywhere), and the ruling makes it explicit. §7.2.1:192 now names both recipients; the batch-15 remediation had HALTED here (Q11) rather than pin one unruled reading (D75(6)). Pinned in pgTAP 017 §S (both rows, privileged read); PROGRESS D76, ledger F37 discharged. One clause + this line.
- **v2.8.8 (2026-07-26):** §12.2 erratum (M1 task L.A1.15, migration 063 — the fold-back rule): the two **placeholder-seat client carve-out policies** v2.8.2 kept on `league_members` ("Commish adds placeholder seats" / "Commish removes placeholder seats") are **dropped**; the table is SELECT-only on the client and every write lives in the L.A1.12–15 SECURITY DEFINER RPCs. Rationale, under the *existing* Q8 ruling ("once created, league state is server-authoritative — no direct client DML") rather than a new product decision: both policies require `team_id IS NULL`, i.e. a seat with **no franchise**, which contradicts §7.2's own placeholder definition ("a `teams` row owned by the commissioner, flagged `is_placeholder`") and is invisible to every capacity check in the build (all of which count `teams WHERE league_id = X AND status <> 'retired'`), so a commissioner could POST directly to `/rest/v1/league_members` and over-subscribe past `team_count` — defeating D47 and the F28 shrink floor — while an RPC-created placeholder (which carries `team_id`) was never client-deletable by them anyway. D52(3)'s stated rationale for keeping them ("the one client-shaped act with no stint implications") no longer holds once a placeholder seat is a franchise. Seats are now created by `add_placeholder_seat` and reopened by `remove_manager(vacate)` / `leave_league`. Rationale recorded as PROGRESS D74(3); pgTAP 006/008/017 pin the new surface.
- **v2.8.7 (2026-07-25):** §12.2 erratum (M1 batch-13 review R80; the fold-back rule — resolved ambiguities go into the spec, not just the decisions log): the pre-draft `faab_balance` re-seed on a `faab_budget` change (shipped in migration 061's `update_league_settings`, L.A1.13) is now stated in §12.2 itself — "seeded from `leagues.faab_budget`" means balances track the budget until the draft starts; the §7.3-header status gate guarantees the re-seed only ever runs pre-draft, where balances carry no history (nothing spends FAAB before `in_season`). Rationale recorded as PROGRESS D70(4); one sentence + this line, no behavior change.
- **v2.8.6 (2026-07-25):** Q10 fold-in — the `playoff_start_week` ↔ `regular_season_weeks` seam (ruled by Chris 2026-07-22, option (a) strict continuity; evidence + options PROGRESS §3 Q10, filed by the batch-6 remediation R62 from L.A1.6/D60(12)'s observation). §7.3.1's note promised a validation §7.3.8 never defined, and no formula fit the printed ranges: strict continuity was unsatisfiable at a 12-week season (start's printed floor was 14) and made start 17 unreachable (needs a 16-week season; the ceiling is 15), while the shipped no-check state accepted an **overlap** (regular 15 + start 14 passed `validateLeagueSettings`). **The ruling:** `playoff_start_week = regular_season_weeks + 1` — no overlap, no gap weeks (an idle league week is a concept nothing defines — L.D0's schedule engine has none), incumbent-consistent (ESPN/Yahoo/Sleeper all derive the playoff start; none lets a commissioner express an overlap). **Errata applied:** §7.3.1 R column 14–17 → **13–16** (13 reachable only at a 12-week season; 17 dropped as unreachable) with the note now naming the formula; ONE new §7.3.8 bullet stating the seam. The field becomes **effectively derived** — the check applies regardless of `playoff_teams` (a points-only league stores the consistent value too; only the playoff-END arithmetic bullet skips at 0), and the creation wizard MAY render it read-only next to `regular_season_weeks` (the `playoff_byes = 'auto'` precedent), stored value kept for §12.1 compat (PROGRESS ledger row → L.A2.1). Implementation: seam check + 13–16 schema range in `src/lib/leagues/settings/league-settings.ts` (per-field message; overlap regression trap + all four boundary edges pinned); defaults (14+15) and the §7.3 round-trip fixture (13+14) already satisfied the rule. No DB change — 040 has no range CHECK on the column (default 15 + NOT NULL only).
- **v2.8.5 (2026-07-22):** Q9 fold-in — ESPN named parity exceptions (M1 task L.A1.9, migration 058; ruled by Chris 2026-07-22, option (a)+(c); full source evidence PROGRESS §3 Q9). **(1) The exceptions:** ESPN's verified in-product default scoring (support articles 360003914032/115003847231 cross-checked against the `leaguedefaults/1` and `/3` payloads, 2026-07-21) scores three categories the App B.4 catalog/current data tier cannot express or observe — FG made 60+ = 6 (the catalog's `fg_50_plus` = 5 carries ESPN's 50–59 value; Sleeper's `fgm_50p` aggregates everything ≥50, so no 60+ signal exists), D/ST safety on a PAT try = +1, and D/ST return score on a PAT try = +2 (no keys, no columns, no feed signal; combined order ~5–15 plays league-wide per NFL season). These ship as **named, documented parity exceptions** — §7.3.3's parity-guarantee bullet and App B.4 annotated. Rationale: keys with no feed signal would be permanently pending, manufacturing a standing E61 badge on every ESPN league every week — strictly worse than a documented ~1-pt/season-scale exception; the guarantee's operative promise (a migrating league's scores feel identical) survives a documented exception. **Ruling condition:** the exceptions are user-visible in the ESPN templates' `description` metadata (a plain-language line a commissioner can read — `scoring_systems.description`, pinned verbatim by pgTAP 012 + the templates tests), not only in migration banners. **Lift path (part (c)):** the September F10 raw-endpoint inspection additionally checks for a Sleeper raw-feed 60+ FG spelling (e.g. `fgm_60p`) and PAT-play detail; a found signal makes expressing the tier a one-PR §23.5 data task and the exception shrinks or closes. **(2) Also recorded:** F19's two ESPN obligations resolved by the same source pass — standard YA values pulled from the in-product payloads (`+5/+3/+2/0/−1/−3/−5/−6/−7` on the nine published buckets, `def_ya_0_99 = +5` anchor-confirmed) and the default product renders the STANDARD PA bucketization (the finer custom-options list is LM-menu-only). Sleeper templates seed App-B best-known values FLAGGED unverified (Sleeper publishes categories but no values; PROGRESS ledger F24). Templates shipped as migration 058 (`is_template` + 6 rows, owner_id NULL, world-readable, client-immutable via the template-ownerless CHECK); authored rules in `src/lib/leagues/scoring/templates.ts` with a TS↔DB equivalence test.
- **v2.8.4 (2026-07-21):** Rounding erratum (M1 batch-5 review R57; fold-back rule — resolved ambiguities go into the spec, not just the decisions log): §7.3.3's "half-up" is pinned as **round half away from zero**, matching `NUMERIC(8,2)` assignment — `−0.005 → −0.01`, live-verified on the local stack (both numeric-literal and float8 paths; PROGRESS D57(2)/D58). The bare term is ecosystem-ambiguous (Wikipedia/IEEE "round half up" = toward +∞ → `−0.005 → −0.00`; Java `HALF_UP` = away from zero) and the two readings diverge at negative half-cent boundaries; E38's determinism rule (JS result ≡ stored result) makes the DB-matching reading the only coherent one. No behavior change — the shipped calculator already pinned it; this names it in the LAW. *(Also corrected in passing: the header Version field had sat at 2.8.1 since v2.8.2 — now tracks the changelog.)*
- **v2.8.3 (2026-07-20):** Q3 fold-in + ESPN D/ST erratum (M1 task L.A1.7, migration 057 — discharges PROGRESS ledger F14's keys half). **(1) Q3 recorded in the spec** (ruled 2026-07-19; PROGRESS §3): the ESPN split-D/ST model's yards-allowed tier keys are the `def_ya_<lo>_<hi>` family per the D21 naming convention, seeded in the `STAT_KEYS` registry on ESPN's **published** bucket boundaries, verified 2026-07-20 against ESPN's official support pages (Scoring-Formats article 360003914032 + D/ST-Scoring article 115003847231): `def_ya_0_99 / 100_199 / 200_299 / 300_349 / 350_399 / 400_449 / 450_499 / 500_549 / 550_plus`, derived at scoring time from a new raw `def_yards_allowed` key/column (D44 — tier indicators are never stored). **(2) ERRATUM (finding, not silent correction):** ESPN's published standard **points-allowed** buckets are `0 / 1–6 / 7–13 / 14–17 / 18–27 / 28–34 / 35–45 / 46+` (values +5/+4/+3/+1/0/−1/−3/−5) — the D21 premise that all three platforms share the `0 / 1–6 / 7–13 / 14–20 / 21–27 / 28–34 / 35+` boundaries is **false for ESPN**, so B.4's `def_pa` family alone cannot express ESPN's table. Resolution per the additive-registry rule: four ESPN-bucket keys (`def_pa_14_17`, `def_pa_18_27`, `def_pa_35_45`, `def_pa_46_plus`) are seeded beside the shared family (0/1–6/7–13/28–34 remain genuinely shared; overlapping indicator keys are harmless — a template references only its platform's buckets, §7.3.3). **(3) Note for L.A1.9:** ESPN's support pages publish the standard PA values and the YA buckets but NOT the standard YA point values — the template task must pull those from the in-product default scoring settings and record them. Also in 057: the D41 box-score columns (per-type 2-pt per D20; `fg_0_39`, `fg_missed`, `pat_missed`, `def_block`, `def_return_td`, `fumble_recovery_td`, `return_td`, `def_yards_allowed`) with registry storage flips, and the D5/D22 adapter completeness re-check (no new mappings — evidence bar unmet for the unmapped keys; R10's `xpmiss` doubt closed by the real 2025-wk2 actuals fixture). *[Addendum 2026-07-20, R50 (M1 batch-4 review): ESPN's published source is internally inconsistent — the same Scoring-Formats article's custom-options list buckets points-allowed as `0 / 2–6 / 7–13 / 14–17 / 18–21 / 22–27 / 28–34 / 35–45 / 46+`, a SECOND, finer bucketization diverging from the standard-scoring list this erratum transcribed (1–6; 18–27 as one bucket). Score-invisible at standard values (18–21 and 22–27 both sit in the 0-point range; PA=1 vs 2–6 differs only for a lone-safety game), so the four seeded keys stand — but L.A1.9 pulls ESPN's in-product defaults and must resolve which bucketization the product renders (PROGRESS ledger F19). In-product cross-check anchor: the D/ST article implicitly publishes one standard YA value — 0 yards allowed = +5 (`def_ya_0_99`).]*
- **v2.8.2 (2026-07-20):** Q8 ruling (Chris — filed by the M1 batch-2 review, PROGRESS R37/R38): **once created, league state is server-authoritative — no direct client DML.** The review live-proved an ordinary authenticated user forging `scoring_rules_snapshot` + `status='drafting'` (and hard-deleting a league) through 001's "League owners can manage" FOR ALL policy, which §12.1 previously said to keep. **(1)** §12.1: that "keep" instruction is superseded — it predates this spec's own protected columns (`scoring_rules_snapshot`, `status`, `settings`), which turned a benign legacy policy into a forgery surface; the policy is dropped with no write replacement (owner SELECT rides the swapped member policy's `owner_id` branch; creation = `create_league` RPC, settings/lifecycle = their RPCs, deletion = the §15.1 soft delete — no client DELETE verb needed). **(2)** §12.2: "Commish manages members" (FOR ALL) is replaced by a placeholder-seat-only INSERT/DELETE pair with **no client UPDATE policy** — seating (`team_id`), roles, and real-user membership move only through the SECURITY DEFINER RPCs, which write `team_managers` stints in the same transaction (closes the client path to stint-less cache rows, the cache⇄history divergence). **(3)** §12.22 integrity (review R40/R43, probed live): `teams.status` CHECK-enforced to its enum; self-succession rejected by CHECK; longer succession cycles are `retire_franchise`'s in-body duty. **(4)** FK indexes recorded (review R39, plan §8.1): `team_managers.league_id`, full `team_managers.team_id`, `league_members.team_id`. Shipped as migration 054 (pgTAP 006/008).
- **v2.8.1 (2026-07-20):** Q7 ruling (Chris — the Q4-application conflicts, PROGRESS §3): **(1)** AI persona/system accounts are exempt from the human username contract: the DB CHECK is `human-pattern OR persona-pattern` (`^[a-z0-9_]{5,20}$` OR `^[a-z0-9]+(-[a-z0-9]+)*-ai$`), and a guard trigger blocks `authenticated`/`anon` from ever writing a persona-pattern username — the hyphen-free human charset + the guard give the `*-ai` AI-transparency convention DB-enforced namespace separation. **(2)** Permanent means **after explicit selection**: the signup-time auto-generated `user_xxxxxxxx` placeholder is pre-selection and the selection page's one UPDATE is sanctioned; the account-settings username field becomes display-only; typo/regret recovery is a support path; a DB-level permanence guard is deferred until the selection flow moves server-side (documented residual: direct-API renames to *valid human* names remain possible until then). **(3)** Dev-seed username `dev` renamed to comply. §7.2 identity table updated; implementation lands with M1 migration 040 (task L.A1.1).
- **v2.8 (2026-07-20):** Three product rulings from Chris (PROGRESS Q4–Q6, ruled 2026-07-20). **(1) Usernames — Q4:** minimum **5** characters, maximum **20**, and **permanent** (no changing after creation) — supersedes both v2.1's 3–20/changeable identity contract (§7.2 table + prose updated; E52 marked obsolete) and the deployed client-side 3–30 rule. No production users exist, so no grandfathering: the DB constraint itself moves to 5–20 as part of the M1 schema work. Uniqueness stays case-insensitive, implemented as a `lower(username)` unique index (not a citext conversion). **Application note:** recording this ruling surfaced two codebase conflicts the M1 conflict report had missed — the account-settings page ships a live username-*change* flow, and the AI persona system stores hyphenated `*-ai` handles in `profiles.username` (production rows) that violate the §7.2 charset the constraint would inherit. The constraint work is **halted pending PROGRESS Q7** (charset/persona exemption + the rename-flow removal + what "creation" means given the pre-selection placeholder); the length/permanence ruling itself stands. **(2) Email invites — Q5:** no email vendor is chosen now; M1 builds invite sending behind a seam (interface only, no vendor binding — D37 confirmed). The v1 minimum bar, vendor-independent: **the league join link is always visible and copyable by the league manager** so they can paste it into any email/text themselves. Vendor selection is deferred until invite-send mail is ready to ship. **(3) Pro gate — Q6:** **neither creating nor joining a league requires Pro** — supersedes §7.2's "Create league (Pro only)", §3.1 goal 6, §15.1, §17, §19.1, and Appendix C L.A1 (all updated); the §20 Pro-conversion metric is retired as written; CLAUDE.md Business Rule #5 rewritten to "League creation and joining are free. Pro-level league features come later." Pro-level league features arrive later as their own features, not as create/join gates.
- **v2.7.1 (2026-07-20):** Errata from the M1 Architect session (delivery plan principle 1 — spec never drifts behind reality). **(1)** §23.5 citation fix (pre-authorized by PROGRESS D21): `core_box` = Appendix **B.1 + B.4** — Appendix B ends at B.4; the old "B.1–B.5" reference was a miscitation. **(2)** Calculator path fix (§5, §11.4, §22.2, Appendix C L.D1): the fantasy-points utility never lived at `src/utils/calculate-fantasy-points.ts`; the legacy utility is `src/lib/scoring/default.ts` (hardcoded, legacy key namespace — research surfaces only), and league scoring uses the §7.3.3 generic dot-product calculator, home `src/lib/leagues/scoring/`. No semantic change to §7.3.3 — the contract was already the law; this names the file. **(3)** §12.1 + §12.22 gap fixes for the deployed schema (M1 survey, conflict report C3/C4/C9 in `tasks-M1-league-foundation.md`): `teams.list_id` DROPs NOT NULL (a league franchise has no backing list; 001's constraint made §7.2's auto-created join/placeholder teams uninsertable); 001's "Users can manage own teams" FOR ALL policy is replaced by an owner-manage policy scoped `league_id IS NULL` — league teams are server-authoritative-only (§8.1), world-readable SELECT retained (§17 public summary); and 001's legacy flat `roster_settings` DEFAULT is replaced with the §7.3.2 canonical default. **(4)** §12.23 alignment (post-breakdown review): the pre-auth claim preview exposes league name + team label **+ inviter display name** (the §16.2/§16.4/§16.5.2 growth-loop design — the old two-field comment was the stale text; tasks-M1 D48), and `league_invites` gains `created_at` + `last_sent_at` so §7.2's "every send/claim/revoke is recorded" is satisfiable (tasks-M1 D46/C18). M1 task breakdown: `docs/specs/tasks-M1-league-foundation.md`.
- **v2.7 (2026-07-18):** Advanced-stat scoring re-scoped (product decision, Chris, M0 Architect Q&A). The specific tracking/charted stats named in §7.3.3/§23.5/Appendix B.2–B.3 (completed air yards, YAC, yards after contact) are **illustrative examples** of the long-run advanced-scoring direction — not v1 data commitments; they were given as examples of the kind of advanced scoring to support once user traction funds a paid real-time stats API (or an in-house feed). Concrete keys, Alpha/Ultra coefficients, calibration (OQ 17), and any vendor decision are **deferred until that funding decision**. What stays committed for v1: the 6 parity templates, the §7.3.3 extensibility contract (generic dot-product + `STAT_KEYS` registry + `player_stats.advanced` JSONB), and the tier machinery (`tracking`/`charted` capability tiers, two-phase provisional→settled scoring, revision handling) — proven in tests with clearly-marked placeholder keys so lighting up real advanced stats later remains a one-PR data task (§23.5 checklist). §7.3.3/§23.5/Appendix B.2–B.3 text stays as the design target, read as illustrative pending funding; the §23.5-vs-B.2 key-name conflict (PROGRESS Q2) is moot until then. Companion resolution (PROGRESS Q1): the free tier supplements Sleeper with **nflverse** for kickoff timestamps (and likely official inactives) — §23.1's live-provider hard requirements are to be met by the Sleeper+nflverse composite (inactives source confirmed when the adapter lands, with the first runtime consumer of kickoffs). §21 OQ 16–17 (charted-data license; Alpha/Ultra coefficient sign-off) are deferred along with the stats they price and calibrate. Same-session follow-up (Chris): the v1 template picker ships the **6 parity templates only** — no Alpha/Ultra teaser cards; the two FieldScout cards and the "same game, scored three ways" widget return with funded advanced stats (§7.3.3/§16/Appendix B/Appendix C "8 templates" references annotated to read as 6 for v1). Delivery plan v1.3 defers M1's Alpha/Ultra backtest gate accordingly.
- **v2.6.1 (2026-07-18):** Erratum from the M0 Architect session (delivery plan principle 1 — spec never drifts behind code): the deployed `nfl_games` column is `kickoff_at` (001_initial_schema.sql), not `kickoff`; corrected the five references (§7.3.4, §12.20, §14, §19.2 E42, §23.3). No semantic change — kickoff-derived locks still read the column at evaluation time. M0 task breakdown: `docs/specs/tasks-M0-foundations.md`.
- **v2.0 (2026-07-16):** Scale + correctness release, informed by platform research (Supabase Realtime scaling guidance, Sleeper/Yahoo/ESPN operational norms, NFL data-provider landscape). **(1) Realtime rewritten (§9):** Postgres Changes replaced by Broadcast-from-Database triggers on private authorized channels — the pattern Supabase recommends beyond ~3k subscribers; clients never subscribe to raw `player_stats`. **(2) Schedule engine + Remix (§11.7):** seeded deterministic generation (circle method, division-aware), preview-diff **Remix** (free until Week 1 kickoff, override after — Sleeper parity plus receipts), `schedule_mode` (`h2h`/`total_points`), Sleeper-style `median_game`, Yahoo-style `second_opponent`. **(3) Scale engineering (§22):** explicit 500-league / 150-draft load model, server-side scoring fan-out via pgmq (`score-league-week`), SKIP-LOCKED job pattern, `player_stats` partitioning, rate limits, k6 gate suite. **(4) Stats & NFL-data contract (§23):** `StatsProvider` interface + GA provider decision, ingestion invariants + degradation UX, `nfl_weeks` calendar, kickoff-derived locks (flex-schedule/postponement-safe), correction window normed to **Thu 06:00 ET** with `stat_correction_events` + league-facing corrections view; post-window corrections flag instead of auto-apply. **(5) Game-day transaction locks (§7.3.4/§13.1):** `player_game_lock` + `bench_lock` (strict defaults per product requirement), `fa_hold_hours`, `trade_lock_behavior`, `waiver_claims.claim_order`. **(6) Integrity fixes:** league **scoring snapshot** (`scoring_rules_snapshot`), 2-decimal rounding determinism, `slot_map` indexed instance keys (`rb:0`), matchup home/away uniqueness + self-play CHECK, pause clock bookkeeping (`deadline_remaining_ms`), auction endgame + solvency invariant, autopick K/D-ST deferral, audit backstop trigger, `SECURITY DEFINER search_path` hardening. **(7) New tables (§12.17–12.21):** `league_weeks`, `team_week_results`, `league_player_pool`, `nfl_weeks`, `stat_correction_events`. **(8) Ops (§24):** golden signals, kill switches, deploy freeze, runbooks. **(9)** Edge cases E25–E46; Open Questions 12–15; product/UX callouts (§16.4) incl. **DL** preset + **Hot Swap** naming. Companion delivery plan doc added.
- **v2.1 (2026-07-16):** Identity & franchise lifecycle. **Identity contract** (§7.2): display name / unique username / private email with explicit display rules (*Team name — display name (@username)*; email never league-visible). **Invites** (§7.2, §12.23): custom league slug (`fieldscout.gg/join/<slug>`), single-use **seat-targeted invites** (link/username/email) with expiry, revocation, and a token-claim RPC. **Franchise ≠ manager** (§7.2.1, §12.22): `team_managers` stint history; manager removal resolves to an explicit outcome — **takeover** (continuity), **retire & succeed** (franchise sealed under its final manager; successor created into the slot, inheriting roster/FAAB and W-L *for seeding only* with partitioned history), or **vacate** (orphan/autopilot with audited `acting_as_team_id` actions). Write access derives from the open stint (instant, race-free revocation). History Mode goes franchise-first with per-stint splits (§11.6); powers table + audit metadata updated (§10); endpoints reworked (§15.1); edge cases E47–E54.
- **v2.2 (2026-07-17):** Advanced-stat scoring + template-only v1. **Thesis** (§2.2, §7.3.3): first fantasy platform with tracking/charting-derived scorable categories — completed air yards, YAC, yards after contact — verified whitespace (no incumbent, incl. Fantrax/MFL, scores any of them). **v1 scope cut:** open custom scoring editor deferred to v1.1; v1 ships a **fixed 8-template picker** — ESPN Std/PPR, Yahoo Std/Half-PPR, Sleeper Std/PPR (full-category platform parity, build-time verification required), **FieldScout Alpha** (*the catch, re-scored*: rec 0.5 + 0.06/completed air yd + 0.12/YAC yd; 100% live) and **FieldScout Ultra** (Alpha + 0.06/rush yd + 0.06/yd after contact stacking, −0.5/sack; charted tier). **Data contract** (§23.5): provider capability tiers (`core_box`/`tracking`/`charted`), new `player_stats` keys, two-phase provisional→settled scoring for charted stats (finalization timing unchanged — the Thu 06:00 window absorbs Mon-AM charting), degradation + revision paths. **Calibration rule:** coefficients tuned via 2026-fixture backtest to ±10% of Half-PPR positional means (OQ 17). Appendix B rewritten as the 8-template catalog; template-picker UX with "same game, scored three ways" widget (§16); adoption metric (§20, ≥25%); OQ 16–18; edge cases E55–E58.
- **v2.3 (2026-07-17):** Mock Draft Mode + scoring extensibility. **Mock Draft Mode** (§8.8, promoted from Phase-F nice-to-have): solo practice from any pre-draft league under its **real** draft config on the **identical** server-authoritative engine (real countdowns via `draft-tick`); CPU opponents are the simulator bots exposed in-product (humanized 20–70%-of-clock timing, near-buzzer picks, solvency-obedient auction bidding); CPU speed toggle (`realistic`/`fast` — never touches the human's clock); zero side effects (`is_mock`, no `league_rosters`/`transactions`); pause/resume, 72h expiry, recap, 3-active cap (§22.5); Phase B/C gates + endpoints + components updated; standalone lobby v1.1. **Extensibility contract** (§7.3.3, §23.5): launch bar re-pinned to the 6 parity templates + a pipeline where new stats are a data task — generic dot-product calculator, `player_stats.advanced` JSONB (no migrations), `STAT_KEYS` registry, one-PR new-stat checklist; Alpha/Ultra behind a per-environment feature flag until feeds verify. Edge cases E59–E62.
- **v2.4 (2026-07-17):** UI completeness audit. §16 is now the exhaustive build list: **new routes** — `/schedule` (view + Remix), `/history`, `/chat`, `/draft/recap`, and the pre-auth **`/join/[token]`** claim page (the growth loop finally has its landing surface); `/u/[username]` gains the cross-league managerial record. **New components** — league-home state machine, schedule-view + remix-modal, corrections-view, waiver-claims-panel (drag claim_order), trade-center (review/vote states), remove-manager-modal, acting-as-banner, claim-invite-card (E53–E54 states), stat-line (Alpha/Ultra splits + pending badge), shared status-banners, draft-setup-panel, mock-recap; lineup-editor/matchup-view/free-agents-table/playoff-bracket lines extended with lock states, member illegal-lineup reporting, scoring-mode variants, and commish edit affordances. **New §16.5:** league-home state machine (§16.5.1), workflow → surface map for all twelve core flows (§16.5.2), scoring-mode display variants incl. total_points leaderboard and median/second-opponent rows (§16.5.3), the global banner/badge/state catalog (§16.5.4), and an explicit not-in-v1 list so deferred UI isn't built by accident (§16.5.5). Design Reviewer agent adopts §16.5 as its coverage checklist (delivery plan).
- **v2.5 (2026-07-17):** `SyntheticStatsProvider` — validate before you pay. **§23.1** reframed around three interchangeable provider tiers behind the same `StatsProvider` interface: `synthetic` ($0, every dev/CI session), `sleeper_free` (v1 beta, real data no SLA), and the paid GA tier (Open Question 14) — the calculator, locks, corrections, and realtime fan-out are identical code regardless of tier. **New §23.6:** the synthetic provider itself — fabricates `core_box` plus `tracking`/`charted` advanced stats so Alpha/Ultra are fully exercisable with zero data cost, runs on the `TimeProvider` virtual clock, and ships a versioned, deterministic scenario library (flexed kickoff, postponement, mass-inactives, provider outage, in-window and post-window corrections, late/revised charting) that reproduces every relevant §19.2 edge case on demand instead of waiting for a real Sunday. OQ 14 recommendation updated: build and fully validate the pipeline on synthetic first, layer in the free real feed for beta signal, and make the paid-vendor call only when GA timing actually requires it.
- **v2.6 (2026-07-17):** Product decisions from Chris's doc review. **League sizes (v1 scope cut):** `team_count` narrowed to **8/10/12/14/16**; 18/20 and odd counts move to OQ 12 as a v1.1 fast-follow (re-widening a CHECK constraint, not new engineering) — updated everywhere sizes are enumerated (§1, §6, §7.2, §7.3.1, §12.1, §16.5.5, §18, §19.1, Appendix C). **Invites (§7.2):** email promoted to the primary seat-targeted channel — since most invitees have no FieldScout account yet, a fresh signup via an email invite gets the email field pre-filled and **locked** to `invited_email`, removing the mismatch case entirely for that path (E65); username invite remains available for existing users. **Playoff tiebreakers (§7.3.7):** v1 default reordered to **Points For → Head-to-head → Points Against** (higher Points Against wins — stronger schedule), with Division record and Coin flip retained only as a deterministic tail; head-to-head explicitly skips for 3+-team ties (E63) and for `total_points` leagues with no matchups to compare (E64). **Hot Swap wording (§6):** glossary tightened to "ruled out pre-game or at any point during the game" — matches the always-generic OUT-designation trigger already implemented in §7.3.2/§11.4/§14 (no behavior change, confirms existing design). **Generalized Act as Manager (§7.2.1, §10.1):** commissioner can act as *any* team, not only an orphaned one — for a manager who's still seated but has gone inactive — with no stint change and no access lock on the real manager; reuses the existing `acting_as_team_id` tagging (§12.12), so this is a UI-availability change, not a new migration (E66).
- **v1.6 (2026-06-24):** Locked the **Swap spot** to a single on/off setting (`swap_spots` = 0/1 — one swap per team; dropped the 0–3 range to avoid confusing mid-week lineup changes) and enforced it with `lineup_swaps` `UNIQUE(team_id, season, week)`. Added a UI rule: render the Swap spot **below Flex/superflex and above K, D/ST, IR**. Resolved the "multiple swaps" open question.
- **v1.5 (2026-06-24):** Added the optional **Swap spot** (§7.3.2) — a team arms **one** same-position bench player to auto-start if a chosen starter is ruled out **pre-game or in-game**; exact `player.position` match required even for FLEX starters; locks at first Sunday kickoff (or Thursday if a Thursday player is involved). New `roster_settings.swap_spots` count, `lineup_swaps` table (§12.16), `process-swaps` worker (§14), enforcement/scoring/validation, UI (`swap-assignment.tsx`), API/hook, acceptance, edge cases E20–E24, and Open Questions 11–12 (in-game resolution + multiple swaps).
- **v1.4 (2026-06-24):** IR spots are now **per-spot configurable** (§7.3.2): each spot is **Unrestricted** (free in/out for eligible players before lock) or **Restricted** (eligible designation + a minimum stint, default 4 weeks, baseball-IL style), with a commissioner-set list of eligible designations. New `roster_settings.ir_slots[]` shape; `league_rosters.ir_placed_week` / `ir_lock_until_week` track tenure; added enforcement (§11.2), validation (§7.3.8), build-prompt notes (L.A2/L.D1), acceptance, and edge cases E18–E19.
- **v1.3 (2026-06-24):** Added the list↔league tie-in — users **attach ranking lists to a league** (§7.4) and use them in the Live Draft Tool (§8.9): cheat sheets, player-pool overlays + "only my list" filter, one-tap load-into-queue, and an optional **primary draft board** that feeds autopick. New `league_lists` table (§12.15) + RLS, API (§15.5), hooks, UI components, build prompt L.B4, glossary entry, and edge case E17.
- **v1.2 (2026-06-24):** Roster section (§7.3.2) generalized so the commissioner sets per-position starter counts, **bench**, and **IR**, and builds **any flex** as a custom eligible-position set (WR/TE, WR/RB, WR/RB/TE, superflex, IDP flex, or any combination). New `roster_settings.starting_slots[]` JSONB shape; lineup legality uses bipartite slot-fitting; added validation, acceptance, and edge case E16. Concurrency target raised to 20-team.
- **v1.1 (2026-06-24):** `team_count` extended to even **8–20** (was 8/10/12/14); `playoff_teams` options extended to 12. Updated the settings catalog, validation rules, SQL `CHECK` constraint, acceptance gates, and Appendix C build prompts to match. (Odd counts still out of scope — easy to enable later.)
- **v1.0 (2026-06-24):** Initial spec. Defines redraft leagues (even **8–20** teams), the server-authoritative snake + auction draft engine with full commissioner live controls, in-season play, and the immutable member-visible Commissioner Action Log differentiator. Supersedes the thin `leagues` schema in `spec-leagues-live-mode.md`. Competitor research in Appendix A; scoring catalog in Appendix B; Claude Code build prompts in Appendix C.

> **Note on scope vs. roadmap:** the project is currently in **Phase 0**. This is a large, late-stage epic that depends on Phases 0–4 + the Live Mode pipeline (§5). Build it after those foundations exist; the phased plan (§18) and prompts (Appendix C) are sequenced to be picked up at that point.












