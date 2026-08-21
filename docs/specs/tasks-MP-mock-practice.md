# Task breakdown: MP — a mock draft is for practicing

**Lane:** MP (`MP.*`) · **Architect session 2026-08-21, rewritten the same day to Chris's second ruling** · **Spec fold: `spec-redraft-leagues.md` v2.16**
**Input:** Chris's rulings of 2026-08-21 (§3) — the first set after a practice draft refused to start in his own app, the second after he read this document's first cut and asked why a mock needed any of it.
**Base:** `main` @ **`1d4620d`**. AP.1/AP.2/AP.3 merged (migrations 091/092/093); the MS breakdown merged (`4bd8690`, spec **v2.15**, D216–D223). **Two PRs open, both holding ledger numbers** — **#180** (DR2) and **#186** (the AP.4 halt). R312 first-filed-keeps (§1.10).
**Status:** authored — **awaiting Chris's approval of this PR. Nothing here is built until it merges.**

> **THIS LANE EXISTS BECAUSE TWO THINGS WERE WRONG, AND THE SECOND IS THE BIGGER ONE.**
>
> **The first is a premise.** §8.8 has said since v2.3 that a mock is *"solo practice under the league's real settings"*, launched *"from a pre-draft league"*, **v1 scope "league-attached only"**. Chris: *"a user may run a mock draft without even being 'in a league'."* **Practice is the purpose. A league is optional context.**
>
> **The second is this document's own first cut, and it is the more useful failure.** Working from the corrected premise, it designed a hidden per-user "practice container" — a `leagues` row nobody sees — so that a league-less mock could still satisfy league-shaped RLS, league-shaped foreign keys and §8.8's isolation rule. Chris read it and said:
>
> *"i didn't think mock drafts were going to add so much complexity. On ESPN and Sleeper you fire up a mock draft, bid or pick in a mock lobby against fake users and it emails you the draft results. I doubt they are doing any of this inivisible league blah blah blah security container stuff"*
>
> **He is right, and the reason is worth more than the correction.** Mocks were built *inside* the leagues system, so they inherited its entire threat model — RLS keyed on league membership, §8.8 isolation, commissioner authority, audit immutability. **All of that exists because a real draft has twelve humans with money at stake. A mock has one human and eleven bots: there is no adversary and nothing to protect.** The complexity was **inherited, not required**, and nobody re-examined it when the purpose changed. That is the **D231(3a)** species one level up — an assumption carried forward past the point where its justification held — and it is why **D228 is withdrawn** (§10 item 1, kept in the record rather than deleted).
>
> **The ruling:** *"what if we just start by only having mocks that run off the base scoring templates and don't inherit any of the custom league logic"* · *"we can get back to the league based mocks after we actually have demand for the league product itself. until then we can invite users to come do mocks for practice."*
>
> **A mock is standalone. Full stop.** No league, no inherited settings, no container. **League inheritance is DEFERRED, not cancelled** — Chris rates it highly and §6 protects it.
>
> **This is launch-facing.** Chris intends to invite users to it during the free-only 2026 launch. It is not an internal tool: states, empty and error handling, and polish are in scope at the level the design language requires.
>
> **The spec is LAW.** Where this document and v2.16 disagree, v2.16 wins and this document gets corrected.

---

## 1. Surveyed facts (2026-08-21; every load-bearing fact opened on `main` @ `1d4620d`, or measured against the **deployed local schema** — the stack was up, so the engine facts below are `pg_proc` reads, not file greps)

Cited by symbol where a symbol exists. Where a fact was measured, **the command is named**. Nothing here is copied from another document.

### 1.1 The refusal Chris hit — and why the new shape dissolves it rather than fixing it

- **`create_mock_draft`'s HEAD is `092_auction_reserve_toggle.sql:1128–1422`** (`for f in supabase/migrations/*.sql; do grep -qE '^CREATE (OR REPLACE )?FUNCTION +(public\.)?create_mock_draft\(' "$f" && echo "$f"; done` → 071 → 089 → **092**), signature `(p_league_id, p_human_team_id, p_cpu_speed, p_action_id)`, `SECURITY DEFINER`, `search_path=''`. **`p_league_id` has no default: a league is mandatory at the signature.**
- **The refusal is `092:1233–1241`** — it counts `teams WHERE league_id = $1 AND status <> 'retired'` against `leagues.team_count` and raises *"league % has % of % franchises seated — a mock drafts the full board, so every seat must exist; add placeholder seats for the empty slots"*. Its comment gives the real constraint: **`draft_picks.team_id` is `NOT NULL` and the order needs every seat.**
- **The remedy the message names is closed to most people who hit it.** `add_placeholder_seat` refuses a non-commissioner twice (`063:404–407` pre-lock, `063:428–433` re-gated under the league lock).
- **In the new shape this problem does not get fixed — it stops existing.** There is no league, so there are no unfilled league seats and **`add_placeholder_seat` is out of the picture entirely**. A mock mints its own N bot opponents. What survives from the first cut is the *constraint* (`draft_picks.team_id` still needs `teams` rows) and **R473's finding** about how those rows are protected (§1.4).

### 1.2 What the engine ACTUALLY reads — config, with two exceptions, and the exceptions are the finding

**This is the claim the whole lane rests on, so it was measured rather than assumed.** *"The engine reads settings from `v_draft.config`, not from the league"* is **true for the clocks, the draft type, the budget and the auction knobs — and FALSE for the roster shape.**

```sql
-- every LIVE draft-family function that references the leagues table at all
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname ~ '^(draft|create_mock|delete_mock|mock_draft)'
  AND p.prosrc ~ 'public\.leagues';
```

**13 functions.** Classified by what they actually do with it:

| Function | What it reads from `leagues` | Reachable by a live mock? |
|---|---|---|
| `draft_make_pick`, `draft_place_bid`, `draft_nominate` | `SELECT 1 … WHERE id = … AND deleted_at IS NULL` — a **soft-delete existence check**, beside `is_league_member` authorization. No settings. | yes — and **both concerns vanish with no league** |
| **`draft_autopick_resolve`** | **`v_league.roster_settings->'starting_slots'`** — the live roster shape | **YES, on every autopick** |
| **`draft_mock_cpu_need`** | **`l.roster_settings->'starting_slots'`** via `JOIN public.leagues l ON l.id = d.league_id` | **YES — this is the MOCK CPU's own roster-need function, on every bot pick** |
| `draft_tick` | `l.settings->'draft'->>'draft_scheduled_at'` for the D94 auto-start arm; the rest are `SELECT 1` existence checks | the auto-start arm is **non-mock only** (`draft_start_internal` filters `is_mock = FALSE`) |
| `draft_complete_internal` | writes `leagues`/`league_rosters` — already inside `IF NOT v_draft.is_mock` | guarded |
| `draft_end`, `draft_reset`, `draft_set_order` | §8.7 commissioner controls | refuse mocks today (the MS lane owns them) |
| `create_mock_draft`, `draft_create_internal`, `draft_start_internal` | launch-time reads | launch only |

- **THE SWEEP IS EXHAUSTIVE, NOT A SAMPLE — one `JOIN leagues` in an engine means you look for the others.** The classification above came from `prosrc ~ 'public\.leagues'` (13 functions, 33 matching lines, every line printed and classified). It was then re-run at the level that actually matters — **what is read**, not **what is joined**:

  ```sql
  SELECT p.proname, m[1] FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
    LATERAL regexp_matches(p.prosrc, '([^\n]*(roster_settings|l\.settings|v_league\.settings)[^\n]*)', 'g') AS m
  WHERE n.nspname='public' AND p.proname ~ '^(draft|create_mock|delete_mock|mock_draft)';
  ```

  **Ten hits, and every one is accounted for. Exactly TWO are live-draft reads and both are the same setting:** `draft_autopick_resolve` (`v_league.roster_settings->'starting_slots'`) and **`draft_mock_cpu_need`** (`l.roster_settings->'starting_slots'`, reached by `JOIN public.leagues l ON l.id = d.league_id`). The other eight are **launch-time** (`create_mock_draft` ×2, `draft_create_internal` ×2, `draft_start_internal` ×2 — all resolving `config`/`total_rounds` once and storing them) or **`draft_tick`'s ARM 1** (×2), the D94 auto-start, which **scans `leagues WHERE status='scheduled'` and never touches a mock**. **There are no other siblings.**
- **`draft_mock_cpu_need` is the worse of the two, and its head is `089_mock_auctions.sql:394`** — re-derived, not recalled (`for f in supabase/migrations/*.sql; do grep -qE '^CREATE (OR REPLACE )?FUNCTION +(public\.)?draft_mock_cpu_need\(' "$f" && echo "$f"; done` → **089 only**; 091 replaced its sibling `draft_mock_cpu_bid_value`, whose head is **`091:271`**, but not this one). **It is inside the CPU value model, on the hot path of every bid.** With no league row to join to, **the join matches nothing, `v_slots` and `v_total` stay NULL, and every bot's need term collapses** — the bots would stop bidding, or bid only on the top of the board. **That is not a degraded mock; it is a broken one**, and it is the single thing most likely to make a league-less mock look "almost working" in a smoke test.
- **THE FINDING, NAMED: the roster SHAPE is read live from the league on every autopick and every CPU need calculation, and it is the one setting `create_mock_draft` never snapshots.** `092:1219` copies `v_league.settings->'draft'` into `config`; **`roster_settings` is a separate COLUMN on `leagues`, not part of that block.** What *is* snapshotted is the derived round count (`draft_rounds_from_roster(v_league.roster_settings)` → `drafts.total_rounds`, `092:1296`), not the slots.
- **So a league-less mock is impossible today for a reason nobody had written down** — not only the FK and RLS shapes, but because **two hot functions would dereference a league that is not there.** MP.2 closes it by snapshotting the slot shape into `config`, which also makes the engine honestly config-driven for the first time.
- **Everything else really is config-driven**, and that is what makes the rest of the lane cheap: `pick_timer_seconds`, `auction_budget`, `auction_nomination_seconds`, `auction_bid_seconds`, `auction_anti_snipe_seconds`, `auction_zero_dollar_nominations`, `draft_type`, `snake_reversal` are all read off `v_draft.config` (or the `drafts` row) at every use site. **Feeding the engine a template is the same input from a different source.**

### 1.3 The storage question, measured — and the figures that correct D228

**MP.1 is an investigation and it must not be pre-empted. What follows is the evidence it starts from, not its answer.**

- **The engine is 58 live functions and 6,252 lines of plpgsql** (`SELECT count(*), sum(...) FROM pg_proc … WHERE proname ~ '^(draft|create_mock|delete_mock|mock_draft)'`).
- **It names its tables literally, everywhere.** Functions referencing each table by `public.<name>`: **`drafts` 37 · `draft_picks` 15 · `league_chat` 15 · `draft_bids` 11 · `draft_liveness` 5 · `draft_queues` 2.** **Dynamic SQL is essentially absent — exactly one function in the family contains `EXECUTE`, and it is `draft_actor_name`.**
- **Therefore mock-OWNED TABLES would mean duplicating or re-pointing 6,252 lines of the most safety-critical code in the build, auction rules included.** That is the outcome the ruling explicitly calls worse than either option, and **MP.1 must say so plainly if it reaches it.**
- **The corrected figures for the same-tables path — and they correct this document's own first cut.** D228(2) priced it at *"50 in-body `is_league_member` sites across 18 migration files"*. **That number counted every occurrence in the migration TREE, including superseded bodies.** Measured against the deployed schema:

  ```sql
  SELECT proname, (length(prosrc)-length(replace(prosrc,'is_league_member(','')))/length('is_league_member(')
  FROM pg_proc … WHERE prosrc ~ 'is_league_member\(' AND proname <> 'is_league_member';
  ```

  **13 calls across 9 live functions** — `create_mock_draft` (1) · `delete_mock_draft` (1) · `draft_make_pick` (2) · `draft_nominate` (2) · `draft_place_bid` (1) · `draft_pause` (1) · `draft_resume` (1) · `draft_touch` (2) · `set_team_autodraft` (2, a league verb and out of scope). **Eight functions on a mock's path, eleven call sites.**
- **RLS: 14 policies mention `is_league_member` across the whole schema** (`pg_policies`), but only **five rows on four draft-path tables** — `drafts`, `draft_picks`, `draft_bids` (one SELECT each) and `league_chat` (SELECT + INSERT). **`draft_queues` and `draft_liveness` carry no `league_id` at all** and are keyed on `draft_id`/`team_id`.
- **`league_id NOT NULL` columns: ten in the schema, four on the draft path** — `drafts`, `draft_picks`, `draft_bids`, `league_chat` (the other six are league-only tables a mock never touches: `league_invites`, `league_lists`, `league_members`, `league_rosters`, `league_weeks`, `team_managers`).
- **So the honest restatement of D228(2) is: four `NOT NULL` drops, five RLS policy arms on four tables, eleven in-body auth sites across eight functions. That is a TASK, not a milestone** — and D228's central argument rested on a number that was roughly 4× too high. **The decision is withdrawn for a different reason (§10 item 1), but the figure is corrected here rather than buried**, because the next person to price this path deserves the real number.

### 1.4 Bot seats — the constraint that survives, and the exposure that travels with it

- **`draft_picks.team_id UUID REFERENCES teams(id) NOT NULL`** (`065:160`); same shape on `draft_bids.team_id` (`083:120`) and `draft_queues.team_id` (`065:193`). **Every seat a mock drafts into needs a `teams` row**, league or no league.
- **`teams.league_id` is nullable** (`001:499`) and standalone teams are a shipped concept with their own RLS (`053:69–71`).
- **R473's finding, live-probed in a rolled-back transaction and carried forward unchanged:** `teams` carries **"Teams are viewable by everyone"** (`001:844`, SELECT `true`) and **"Users can manage own standalone teams"** (`053:69–71`, `FOR ALL USING (auth.uid() = owner_id AND league_id IS NULL)`). Probed as `authenticated`, the owner got **`UPDATE 1`** and **`DELETE 1`** on such a row. And `draft_picks.team_id`'s FK is plain `REFERENCES teams(id)` — **`NO ACTION`** — so **deleting a bot's seat before its first pick is permitted and wedges the mock at that seat's turn.**
- **This is the one piece of "protect the mock" work that is genuinely required**, and it is required for a reason that has nothing to do with adversaries: **it stops a user breaking their own practice in a way the product cannot recover from.** MP.3 owns it.

### 1.5 The entry points — one is new, one is now DEFERRED

- **Home has no mock affordance.** `grep -rniE "mock.?draft|practice" src/components/home/` → **no matches**. *(The broader `grep -rn "mock" src/components/home/` returns six lines and all six are mock-**data** disclaimers — `waiver-adds-card.tsx:12`, `:25`, `injury-news-card.tsx:28`, `trending-players-card.tsx:20`, and two *"not in the package mock"* notes at `recently-viewed.tsx:18` and `ai-expert-shelf.tsx:47`.)* `HomeQuickActions` (`home-quick-actions.tsx:47–90`) holds three chips — Join and League, both `leagues`-gated `toast()` stubs (`:52–80`), and List, which opens the real dialog (`:82–88`).
- **The League Home button already exists** — `PracticeCta` renders immediately after `Enter draft lobby` at `league-home-states.tsx:463–468`, again in `SetupHero` at `:326`, and at `draft-lobby.tsx:251`; label `Run mock draft`; its disabled branch (`:538–545`) is dead since `MOCK_LAUNCHER_READY = true` (`mock-launcher-entry.ts:10`). **Under the new shape this stays exactly as it is and is NOT re-labelled** — it launches a league-attached mock, which is the deferred feature (§6). Re-labelling it *"Practice drafting here"* while it does the deferred thing would advertise the deferred feature as shipped.
- **`useMockDrafts` is league-scoped** (`use-mock-drafts.ts:42–48`, key `['mock-drafts', leagueId]`), service `listMockDrafts` (`draft-service.ts:1411`), and the whole mock API lives at `/api/leagues/[id]/mock-drafts` (`find src/app/api -path '*mock*'` → two route files, nothing else). **A user-scoped list is new work.**

### 1.6 A recap already exists — and the flat table is genuinely missing

- **`DraftRecap`** (`draft-recap.tsx`, 562 lines) + `draft-recap-ops.ts` (159), mounted at `(shell)/leagues/[leagueId]/draft/recap/page.tsx`; `?draft=<id>` targets a specific completed draft — the mock path (page docblock `:15–21`).
- **Two cards, both grouped by team:** *"Final board"* (`DraftBoardGrid` for snake/linear, `AuctionFinalBoard` for auction — `draft-recap.tsx:264–283`) and *"Your roster vs the CPUs"* (`:284–312`).
- **The auction already has a flat cut** — `recapBuysInOrder` (`draft-recap-ops.ts:157–159`) rendered by `AuctionFinalBoard` (`:411–467`) as a `<ul>` of `#{pick_number}` · position · player · team · `${price}`. **`recapTeamSpend` (`:130–152`) gives per-team totals.**
- **Missing: a real table with headers; the snake column set entirely; and a non-league home.** *(`grep -n "Back to league" …` → `draft-recap.tsx:143`, `:235`, `:555`; `mock-draft-launcher.tsx:103`, `:119` — five links, all league-shaped.)*
- **Persistence is solved.** `delete_mock_draft` (HEAD `071:469–515`, launcher-keyed at `:500–504`, chat swept at `:509–511`) and `mock_draft_expire` (HEAD `071:524–610`, cron `071:622`, `'0 3 * * *'`).

### 1.7 The release gate, and the room's route — the guard that decides whether independence is real

- **`src/lib/feature-flags.ts`** states its own doctrine: *"One flag per surface, deliberately"* (`:27–31`) and *"a flag with one branch is a lie about what ships"* (`:51–54`); `enabled()` at `:13–17`; each flag must read its env var **literally** (`:9–11`). **`featureFlags.leagues`' docblock is stale** — *"mock-data UI, no backend yet"* (`:20`) — filed as **F103**.
- **Every `/app/leagues` URL is hard-redirected when the leagues flag is off, and the mock room is one of them.** `src/app/app/(room)/leagues/layout.tsx:18` is `if (!featureFlags.leagues) redirect('/app')`; its docblock (`:5–12`) says *"every /app/leagues route (index, workspace, live draft) is unreachable — even by direct URL"*. `find 'src/app/app/(room)' -type f` → **three** files: `layout.tsx`, `leagues/layout.tsx` (the gate), `leagues/[leagueId]/draft/page.tsx` (the room). **Pinned at `src/lib/route-groups.test.ts:223–232`.**
- **So `featureFlags.mockDrafts` cannot reach past it** — different flag, different layout. **MP.6 gives the mock room a route of its own, keyed on the mock's id.** Under the new shape this is no longer a rescue of a container's URL; it is simply where a standalone thing belongs.
- **Measured: no conflict with PR #180.** `git diff main...pr180 --stat` → **five files, all under `docs/`**. DR2's PR touches **no code at all**.

### 1.8 The base scoring templates exist, and they are exactly what the ruling names

- **Six template rows ship** (`SELECT name FROM scoring_systems WHERE is_template` on the deployed schema): **ESPN Standard · ESPN Full PPR · Sleeper Standard · Sleeper Full PPR · Yahoo Standard · Yahoo Half PPR** — the six parity templates of spec §7.3.3 / App B, seeded by migration 058.
- **So *"mocks that run off the base scoring templates"* maps onto shipped rows and needs no new scoring content.** The first cut's invented *"Scout Scoring"* preset is **withdrawn** (§10 item 2): Chris used that phrase describing how a *public league* product would work, and public leagues are not this lane.

### 1.9 The clocks and the 45-minute bar — what Chris settled directly

- **The defaults, ruled 2026-08-21 and identical for real leagues and mocks: nomination 30s · bid clock 20s · a bid landing under 10s resets the clock to 10s.** Chris: *"the default clock time shouldn't change for mocks, just let the user make the clocks what they want. Use the same default … Everyone is going change the clock times so the defaults are merely a suggestion."*
- **All three are the shipped values — swept, not sampled.** `grep -rhoE "auction_bid_seconds'\)::int, *[0-9]+" supabase/migrations/*.sql | sort | uniq -c` → **9 occurrences, all 20**; the same for `auction_nomination_seconds` → **8, all 30**; `auction_anti_snipe_seconds` defaults to **10** (`league-settings.ts:223`, D128's floor at `085:778`) and anti-snipe is exactly *"a bid inside the last N seconds re-floors the clock to N"*. Schema bounds at `league-settings.ts:257–258`. **Zero lines change for any of the three.**
- **The 45-minute bar is DE-TARGETED.** *"My point about finishing a mock in 45 minutes was just an example not a target because previously it was 3 hours which basically makes it useless. with all the other fixes we've put in I think we're good."* **F85 stops being a bar to hit** (§8), and the spec's acceptance-criteria sentence is amended to say so.
- **Consequence for Q23:** the question *"does the 10-second mock number override a league that chose its own?"* **has no subject in the new shape** — there is no league to inherit from and no mock-specific default. **Q23 is GONE, not answered** (§8).

### 1.10 Numbers and chain heads (confirm again at task time — D161)

**Number note (D161's grep-together rule).** R, D, F, Q, E and B swept **together** across `main` @ `1d4620d` and **both** open branches (`gh pr list --state open` → **#180** `docs/DR2-draft-room-v2`, **#186** `halt/AP.4-mock-bid-clock-Q23`), over `PROGRESS-leagues.md`, `spec-redraft-leagues.md`, `ACTIVE-BUILD.md` and every `docs/specs/tasks-*.md`.

| Counter | `main` | #180 | #186 | **This session takes** |
|---|---|---|---|---|
| R | 469 | 455 | 469 | *(none — Architect sessions file no findings; this PR's review round opened at **R470**)* |
| D | 223 | 212 | **224** | **D225–D233** *(D228 is occupied by its own **withdrawal**, never reused)* |
| F | 101 | 97 | 101 | **F102–F108** *(**F105 withdrawn** with D228 — the number is retired, not recycled)* |
| Q | 22 | 21 | **23** | **Q24** *(one, §11)*; **Q23 lapses** (§8) |
| E | 77 | 74 | 77 | **E78–E80** |
| B | 5 | — | **5** | *(none — this PR **clears** B5)* |

`D700` / `F97316` are the `#FFD700` / `#F97316` hexes in `spec-tier-view.md`, excluded per **D180**. **F97 on `main` is a real row** as well as a hex; the ledger value is 97.

- **Spec version: v2.16.** `main` is at **v2.15** (`spec:4`); #180 holds **v2.14**; **#186 does not touch the spec** (`git diff main...pr186 --stat` → `ACTIVE-BUILD.md` + `PROGRESS-leagues.md` only).
- **Migrations top at 093; pgTAP tops at 041.** MP expects **094+** / **042+**, but **AP.5, AP.6, MS.2–MS.4 and SE all contend for the same band.** Confirm the real next-free with `ls supabase/migrations/ supabase/tests/` at task time and **do not trust a number written here** (D161/D166).

---

## 2. The two corrections

### 2.1 The premise: a league is optional context, not a prerequisite

**What the spec assumes.** §8.8, since v2.3: *"solo practice under the league's real settings"*; *"any league member starts a mock from a pre-draft league"*; **"v1 scope: league-attached only."** D103(1) adds the seat requirement, and the code implements all of it faithfully. In this reading a mock is a **rehearsal of one specific league**.

**What is true.** *"the main use case is just 'I want to practice drafting these players at these rounds or cost to see where my team ends up at the end'."* **Practice is the purpose.** And the reason the premise held is Chris's own model of the two league types: **friends leagues settle everything by group text and enter it *"when they are all in the draft lobby together"*** — so the moment someone most wants to practise is **before any league on the platform has the settings in it.** The spec assumed the league arrives first; in the real workflow it arrives last.

**The failure that told on it.** *"practice draft failed, it says i need 11 more people"* is `092:1233–1241` **working exactly as designed and answering the wrong question.** It was read in-session as a UX gate — a wording problem. It is neither: the remedy it names is closed to non-commissioners, and for a commissioner it asks the user to permanently deform their real league to run a throwaway. **The generalisable half: an error message that is working exactly as designed is the most expensive kind of bug, because every instinct says to reword it.**

### 2.2 The bigger one: the complexity was inherited, not required

**This document's first cut got the premise right and then paid full price for it.** To let a league-less mock satisfy league-shaped RLS, league-shaped foreign keys and §8.8's isolation rule, it designed a hidden **practice container** — a `leagues` row nobody sees, with an exclusion predicate on every league-enumerating surface, a standing forward obligation (F105) for surfaces that do not exist yet, and a member-role decision to stop it becoming a functional league by accident. Every piece of that was *sound given the constraints*. **Nobody asked whether the constraints applied.**

Chris did: *"I doubt they are doing any of this inivisible league blah blah blah security container stuff."*

**Why they are not, stated as the rule this lane is built on.** Mocks were built inside the leagues system and inherited its **threat model**: RLS keyed on league membership, §8.8's zero-side-effects isolation, commissioner authority, audit immutability. **Every one of those exists because a real draft has twelve humans with money at stake — an adversary, a dispute, a record that must survive.** A mock has **one human and eleven bots**. There is no other party to protect the user from and no party to protect from the user. **The security model was inherited from the neighbours, not derived from the thing.**

**What survives the deletion, and it is short.** Two things genuinely need protecting and neither is about adversaries: **(a)** a user must not be able to break their own practice irrecoverably (§1.4's seat-delete wedge — R473), and **(b)** one user's practice must not be readable or drivable by another, which is one ownership predicate (*you own it*), not a membership graph.

**The failure mode, recorded because it will recur.** This is **D231(3a)'s species one level up**: an assumption carried forward past the point where its justification held. The route-guard version was *"a release-independence claim is a claim about routes as well as components."* The general version is: **when a feature moves out of the context it was born in, its inherited constraints are the first thing to re-derive — not the last.** The first cut re-derived the *premise* and left the *threat model* untouched, which is why it produced a careful design for a problem that had stopped existing.

---

## 3. The rulings this lane implements (Chris, 2026-08-21 — verbatim)

### 3.1 The premise that is wrong
> "also keep in mind a user may run a mock draft without even being 'in a league'. i'm not sure why you are so focused on making a mock draft connected to a specific leagues settings. … This is context so you can stop chasing down things that don't matter."

### 3.2 What a mock is FOR
> "when it comes to Mocks, the main use case is just 'I want to practice drafting these players at these rounds or cost to see where my team ends up at the end'. But they may not have an actual league they are in yet or their friends league probably hasn't decided on everything yet."

### 3.3 The two league types, which explain why
> "There are two main types of leagues, public leagues that random people sign up for that must have a set time because otherwise you can't reliably get strangers organized … (and typically the platform would actually dictate public league rules and scoring for consistency, 'Scout Scoring'). Okay, then the OTHER type of a league is a friends league where everyone has been doing this for years together. Those leagues typically use email and group texting to schedule the draft day and time. And they would talking off the FieldScout platform about all the league settings and details and then they will agree to those settings and put them into the tool when they are all in the draft lobby together."

### 3.4 The two entry points *(the second is now DEFERRED — §6)*
> "I think there are two entry points to launching a mock draft. One being from the FieldScout.gg Home tab. This where you will launch a mock based on public league settings which will be standardized. The second would be from a League Home you are already, a button that sits next to the real launch draft lobby button that says 'Practice drafting here' and this one inheriting your league settings is actually a really awesome feature that current platforms fail to do effectively."

### 3.5 The report
> "it would also be great to have a Mock Draft Report that lives somewhere, that is basically a table of every player from the draft and their cost and what team they went to."

### 3.6 Where reports live
> "mocks should go to something on the User's profile, not at the league level. However, real drafts should have a place at the league level."

### 3.7 The navigation
> "under the More... section there can be a Mock Drafts tab that opens to show all past mock drafts and the user can click on each one to open it up and view the results."

### 3.8 Mocks are independent of league work
> "Mocks do not need to be connected to League work"

### 3.9 The challenge that produced the rewrite
> "i didn't think mock drafts were going to add so much complexity. On ESPN and Sleeper you fire up a mock draft, bid or pick in a mock lobby against fake users and it emails you the draft results. I doubt they are doing any of this inivisible league blah blah blah security container stuff"

### 3.10 The new shape
> "what if we just start by only having mocks that run off the base scoring templates and don't inherit any of the custom league logic"

> "we can get back to the league based mocks after we actually have demand for the league product itself. until then we can invite users to come do mocks for practice."

### 3.11 The clocks, and the 45-minute bar
> "the default clock time shouldn't change for mocks, just let the user make the clocks what they want. Use the same default … Everyone is going change the clock times so the defaults are merely a suggestion."

> "My point about finishing a mock in 45 minutes was just an example not a target because previously it was 3 hours which basically makes it useless. with all the other fixes we've put in I think we're good."

### 3.12 Design decisions (Architect; **D225–D233** — they enter PROGRESS §4 verbatim at merge, the D126–D143 / D197–D203 / D216–D223 precedent)

#### D225 — Lane charter, numbering, and what the rewrite changed

1. **MP is a lane, not a set of MS tasks.** MS's charter is *authority inside the room* — who may drive a mock once it exists. MP's is *what a mock is, how you get to one, and what you take away.* Under the new shape they barely touch at all (§7).
2. **Task ids are `MP.1`–`MP.11`.** No `L.C`, `AP.`, `DR2.`, `SE.` or `MS.` id is reused, retired or renumbered.
3. **Numbers taken: D225–D233, F102–F108, Q24, E78–E80, spec v2.16.** **D228 is occupied by its own withdrawal and F105 is retired with it** — neither number is recycled, because a withdrawn decision that leaves no trace is how a rejected design gets re-proposed as a fresh idea.
4. **This PR folds the spec, and it has to.** §8.8's *"v1 scope: league-attached only"* is LAW and is what ruling 3.1 contradicts; §8.8's 45-minute acceptance bar is LAW and is what ruling 3.11 de-targets. Leaving either would oblige the first Builder to halt.
5. **This lane does NOT touch `ACTIVE-BUILD.md`** — **F102**, the F98 precedent, with a named actor: PR #180 rewrites that block and the loop-order list.
6. **The rewrite deleted more than it added.** Withdrawn: the practice container (D228), the invented *"Scout Scoring"* preset, the 10-second mock bid clock, the mock-report/league-recap route split, and F105. **Kept: everything that serves a user** — the Home entry, the room's own route, the report, the profile list, the More… entry, the flag, and the leagues-off pin.

#### D226 — Two corrections, and the second is the transferable one

1. §2.1 and §2.2 are the entry, in full, and they govern the lane. **A task that reads as "make league attachment nicer" has misread 2.1; a task that adds a protective mechanism without naming the party it protects against has misread 2.2.**
2. **The threat model was inherited, not derived.** RLS-by-membership, §8.8 isolation, commissioner authority and audit immutability all exist because a real draft has **twelve humans with money at stake**. **A mock has one human and eleven bots.** No adversary, nothing to protect.
3. **What genuinely survives, and it is two things:** a user must not be able to break their own practice irrecoverably (**§1.4/R473**), and one user's practice is not another's to read or drive — **one ownership predicate, not a membership graph.**
4. **The failure mode, generalised:** *when a feature moves out of the context it was born in, its inherited constraints are the first thing to re-derive, not the last.* The first cut re-derived the premise and left the threat model untouched, and so produced a careful design for a problem that had stopped existing. **This is D231(3a)'s species one level up.**
5. **Recorded rather than tidied away.** The container design is kept as **D228, withdrawn**, with its corrected figures, so the reasoning is legible and the design is not re-proposed as new.

#### D227 — Bot opponents: the constraint that survives, and the one protection that is real

1. **`draft_picks.team_id` is `NOT NULL` FK `teams`** (`065:160`; same on `draft_bids` `083:120` and `draft_queues` `065:193`), so **every seat needs a `teams` row** — league or no league. This is the *only* part of the old seat problem that survives.
2. **A bot seat is a `teams` row with `league_id IS NULL`, `owner_id` = the launcher, `list_id NULL`**, minted in the launch transaction and deleted with the mock. `teams.league_id` is already nullable (`001:499`) and standalone teams already have their own RLS (`053:69–71`). **`add_placeholder_seat` is out of the picture entirely** — there is no league to seat.
3. **The exposure is real and is NOT an adversary problem (R473, live-probed in a rolled-back transaction).** `teams` carries *"Teams are viewable by everyone"* (`001:844`) and *"Users can manage own standalone teams"* (`053:69–71`); as `authenticated` the owner got **`UPDATE 1`** and **`DELETE 1`**. `draft_picks.team_id`'s FK is **`NO ACTION`**, so deleting a bot's seat before its first pick **wedges the mock at that seat's turn with no in-product recovery.**
4. **Disposition: narrow the policy for DELETE; accept UPDATE; accept world-readability explicitly.** Renaming your own bot is cosmetic and self-inflicted; **deleting one mid-draft breaks the practice in a way the product cannot fix**, and that is the line the policy should express. World-readability is accepted and stated rather than hidden — a bot seat carries a label and nothing else (§17). **This is D226(3)'s "a user must not break their own practice", not a security control.**
5. **Naming gets one rule, not a system.** `CPU 1 … CPU N`. No avatars, no personas, no generated team names. Chris ruled no explanatory copy for the mock surface (MS D221(1)) and the same restraint applies.
6. **Deletion order is a Builder trap.** `draft_picks` cascades from `drafts`; `teams` has **no** cascade from `drafts`. Delete the draft **first**, the seats **second**, in one transaction, or the FK refuses.

#### D228 — **WITHDRAWN** — the practice container, why it was proposed, its corrected figures, and why it became moot

**Kept in the record rather than deleted. A withdrawn decision that leaves no trace is how a rejected design gets re-proposed as a fresh idea.**

1. **What it proposed.** A hidden per-user `leagues` row backing every league-less mock, so that league-shaped RLS, league-shaped FKs and §8.8 isolation could all be satisfied without touching the engine. It carried an exclusion predicate on every league-enumerating surface (F105), a `'manager'`-not-`'commissioner'` member role (R479), and a route requirement so its id never reached the address bar (R470).
2. **Why it was proposed, and this was sound reasoning from an unexamined premise:** the alternative looked enormous. D228(2) priced "make the league optional" at *"4 `NOT NULL` drops, 13 RLS policies, **50 in-body `is_league_member` sites across 18 migration files**"* and concluded *"that is a milestone, not a lane."*
3. **THE FIGURE WAS WRONG, AND BY ROUGHLY 4×.** It counted every occurrence in the migration **tree**, superseded bodies included. Measured against the deployed schema (§1.3): **13 calls across 9 live functions — 11 sites across 8 functions on a mock's path**; **five RLS policy rows on four draft-path tables**; **four `NOT NULL` drops**. **That is a task.** The correction is recorded here because the next person to price this path deserves the real number, and because *a decision resting on a measurement is only as good as the measurement*.
4. **Why it is withdrawn, and it is NOT because of the figure.** Chris's ruling removed the requirement the container existed to serve. **There is no §8.8 isolation obligation for a mock that has no league**, no membership graph to satisfy, and no threat model to inherit (D226). **The container was a careful answer to a question that stopped being asked.**
5. **F105 is retired with it** — its whole content was the container's enumeration obligation. The number is not recycled.
6. **What the storage shape actually is, is `MP.1`'s to determine by measurement** (D233). This entry does not pre-empt it; it only stops the container being the answer.

#### D229 — Settings come from the base templates, and the shape that keeps league inheritance a FILL rather than a rewrite

1. **The six base scoring templates already ship** — ESPN Standard / Full PPR, Sleeper Standard / Full PPR, Yahoo Standard / Half PPR (`SELECT name FROM scoring_systems WHERE is_template` → 6 rows; migration 058, spec §7.3.3 / App B). **Ruling 3.10 maps onto shipped rows and needs no new scoring content.**
2. **The invented *"Scout Scoring"* preset is WITHDRAWN.** `grep -rn "Scout Scoring" docs/ src/` → no matches; Chris used the phrase describing how a **public league** product would dictate rules, and **public leagues are not this lane.**
3. **The draft settings come from the schema's own defaults, which Chris has now ruled directly and which are already the shipped values** (§1.9): **nomination 30s · bid 20s · anti-snipe 10s · pick timer 90s**, `DEFAULT_ROSTER_SETTINGS` for the roster (`league-settings.ts:164`). **No mock-specific default of any kind** — *"Use the same default."* **Zero lines change for the numbers.**
4. **THE DEFAULTS ARE A SUGGESTION AND THE USER CHANGES THEM AT LAUNCH.** *"just let the user make the clocks what they want … the defaults are merely a suggestion."* So the launch surface is a real settings form, not a fixed preset — which is also what makes the deferred feature cheap.
5. **THE DEFERRAL CONSTRAINT, AND IT IS A DESIGN RULE ON MP.4 (§4 rule 12).** **Do not build the settings path such that values can only come from a template.** The launch RPC takes a **settings object**; where it comes from is the caller's business. **League inheritance must later be "fill this object from a league instead of from a template" — a new source, not a rewrite.** A Builder who hard-codes template lookup inside the launch RPC has broken this rule.

#### D230 — The report: one flat table, two column sets

1. **Chris asked for a table:** *"a table of every player from the draft and their cost and what team they went to."* Today the auction has a **list** (`AuctionFinalBoard`, `draft-recap.tsx:411–467`) and snake has a **grid**; neither is a table and **snake has no flat cut at all**.
2. **TWO COLUMN SETS, NOT ONE TABLE WITH BLANKS.** Auction: *player · position · team · **price** · **nomination #***, with per-team spend. Snake/linear: *player · position · team · **round** · **pick #***. A single five-column table prints an empty `price` on every snake row and an empty `round` on every auction row — **an empty column claims the value exists and is unknown, which is false in both directions.** `recapBuysInOrder`'s docblock already makes this argument about the board; this is the same argument one layer out.
3. **Compose, do not re-solve.** `recapBuysInOrder` (`draft-recap-ops.ts:157–159`) is the auction row set; `recapTeamSpend` (`:130–152`) the totals; the snake sibling is one new pure derivation **in the same ops file**. **A second recap component tree is the LV.7 failure pattern.**
4. **The route split of the first cut is WITHDRAWN as a task.** With league-attached mocks deferred, there is no ongoing stream of mock recaps at the league level to split off. **The league recap keeps real drafts and is otherwise untouched**, and the one residual — **legacy mock recaps that already exist under `?draft=<mock_id>`** — is a single item inside MP.8, not a lane task.
5. **Chris's *"it emails you the draft results"* (ruling 3.9) is an OBSERVATION about the incumbents, not a request, and email is NOT in this lane.** Recorded so the omission is deliberate: the report has a permanent home and a list, which is the durable version of the same value. If Chris wants the email, it is a small follow-up on top of a report that already exists.

#### D231 — The lane's own release gate, and the route layer

1. **`NEXT_PUBLIC_FLAG_MOCK_DRAFTS` → `featureFlags.mockDrafts`, never `featureFlags.leagues`.** Chris: *"Mocks do not need to be connected to League work."* Precisely the case `feature-flags.ts:27–31`'s doctrine exists for.
2. **THIS IS A RELEASE STATEMENT, NOT A CODE-ISOLATION ONE.** A mock still runs on the **shared draft engine** — `drafts`, `draft_tick`, the room, the same RPC family, the same suites — **and that sharing is correct and stays** (it is also, per §1.3, what makes the lane affordable at all). What must not exist is a **dependency**: no MP task is blocked on a league task, and **turning the leagues flag off must not turn practice off**.
3. **The pin is the assertion that keeps it true.** With `leagues` **off** and `mockDrafts` **on**: the Home entry renders and launches, **the room loads**, the More… tab renders, `/app/mocks` lists, a report opens. MP.11 owns the end-to-end; MP.7 and MP.9 carry their halves.
3a. **AND THE ROOM HALF IS REFUSED BY A SHIPPED, PINNED ROUTE GUARD UNTIL `MP.6` LANDS (R470).** `(room)/leagues/layout.tsx:18` hard-redirects every `/app/leagues` URL when the leagues flag is off — *"even by direct URL"*, per its own docblock — and the mock room is one of those URLs (§1.7). **`featureFlags.mockDrafts` cannot reach past it**, because the gate is a different flag on a different layout. **This was missed in the first cut and the failure mode is the one worth keeping:** *a release-independence claim is a claim about ROUTES as well as components, and the route layer had a guard the component layer could not see.* **§2.2 is this same failure one level up**, which is why both are recorded.
4. **The flag gates UI SURFACES ONLY, never a `SECURITY DEFINER` RPC.** A `NEXT_PUBLIC_` flag is client-inlined; gating server authority on one is a client-side gate on a server-authoritative surface, which §12 forbids.
5. **Under the new shape there is NO surface with a legitimate leagues dependency.** The first cut carved out the League Home CTA; that CTA now belongs to the **deferred** feature and stays exactly as it is (§6). **Every MP surface works with leagues off, with no exception to state.**

#### D232 — Q23, the fidelity question and the mock bid clock are GONE, not answered

1. **Q23 asked whether a 10-second mock bid clock overrides a league that chose its own. Under the new shape the question has no subject:** there is no league to inherit from and **no mock-specific default to override with** — Chris ruled *"Use the same default."* **Q23 LAPSES.** It is recorded as lapsed rather than resolved, because "we answered it" would misdescribe what happened: **the design changed underneath it.**
2. **§8.8's fidelity sentence — *"A mock is slow when the league's clocks are slow, and that is correct"* — stays, and is DORMANT while inheritance is deferred.** It is a statement about a league-attached mock; there are none for now. **Not amended, not weakened, not deleted** — it is exactly the sentence the deferred feature will need on the day it returns.
3. **AP.4 has nothing left in it.** Its ruled half already ships (§1.9: bid 20 ✅ · nomination 30 ✅ · anti-snipe 10 ✅ · ranges and floor ✅ — zero lines change), and its unruled half was the override, which no longer exists. **B5 clears.**
4. **AP.4's record is NOT edited by this PR** — the disposition is escalated (the reviewer's R472) and a lane document must not close another lane's task by assertion. **F106** files the obligation with a named actor.
5. **F85 IS DE-TARGETED, and this is Chris's ruling, not an Architect's read.** *"My point about finishing a mock in 45 minutes was just an example not a target … I think we're good."* **The under-45-minute bar stops being a gate**, the spec's acceptance-criteria sentence is amended to say so, and **no MP or AP task is measured against it.** **F92 survives on its own merits** — the CPU nomination still rides the 5-second sweep, and that is a real pacing cost — but it is now *"a thing worth fixing"*, not *"the other term in a bar we must hit."*

#### D233 — The storage shape is an INVESTIGATION, and what the measurement already establishes

1. **MP.1 decides it, and it comes first.** The question: **can the draft engine operate on mock-owned storage without duplicating the auction/snake logic?** The answer is a measurement, not a preference, and **the deliverable is a decision with evidence, not code.**
2. **What is already measured, so MP.1 starts from facts rather than a blank page (§1.3).** The engine is **58 live functions / 6,252 lines** of plpgsql; it names its tables **literally** (`drafts` in 37 functions, `draft_picks` 15, `league_chat` 15, `draft_bids` 11, `draft_liveness` 5, `draft_queues` 2); and **dynamic SQL is essentially absent — one function in the family contains `EXECUTE`, and it is `draft_actor_name`.**
3. **So the ruling's own guardrail is the likely finding, and MP.1 must state it plainly if it reaches it: separate mock tables mean either two copies of the auction rules or a rewrite of 6,252 lines into table-agnostic dynamic SQL — and BOTH are worse than either option.** Duplication is worse for the obvious reason. Dynamic SQL is worse for a less obvious one: it would break the `search_path=''` discipline every one of these functions is built on (tasks-M* §4.1), and it would make the pgTAP suites assert against a body that no longer names what it touches.
4. **The same-tables path is now priced honestly and it is task-sized** (§1.3, correcting D228(2)): four `NOT NULL` drops, five RLS policy arms on four tables, eleven in-body auth sites across eight functions. **"You own it" is one predicate** — `config->'mock'->>'launched_by' = auth.uid()::text`, the idiom `draft_pause`/`draft_resume` already ship (`069:404–415`).
5. **MP.1 must nevertheless check the thing that would change the answer:** whether a nullable `league_id` weakens any **real-league** guarantee. A policy that reads *"member of the league OR launcher of this mock"* must be provably no more permissive for a row that HAS a league. **If that cannot be shown, the answer changes and the task says so.**
6. **Do not pick the shape by preference, and do not let this decision be made inside a task that is also building something.** The MS.1 precedent: a task that audits *and* enables will report on its own work.

---

## 4. Standing rules for every MP task

**`tasks-M3-auction.md` §4 rules 1–8 carry forward verbatim and in full force** — M1's four (grants doctrine D18→D23 · SECURITY DEFINER = in-body auth + `search_path=''` + REVOKE, §4.1 · the no-write-policy pgTAP pattern per role with RETURNING counts, §4.2 · the falsifiability floor incl. the ≥1 deliberate-break probe SHOWN failing and reverted, §4.3 · the migration checklist + typegen alias-block re-append, §4.4), M2's realtime doctrine (rule 5) and draft-row lock discipline (rule 6, incl. SQLSTATE conventions and held-lock < 50 ms per RPC family), and M3's solvency doctrine (rule 7) and bid-path discipline (rule 8). Builders cite all eight in the self-review note.

**Reproduced verbatim from `tasks-DR-draft-room-redesign.md` §4 rule 9**, because this lane's central claims — *"this works with no league"*, *"the flag is independent"*, *"the engine only reads config"* — are the species easiest to assert from intent and hardest to notice when wrong:

> **A claim about the state of the world after your change must name the command or observation that establishes it — the falsifiability floor of tasks-M1/M2/M3 §4 rule 3, applied to prose — *no pin counts as a pin until it has been shown RED against the defect it claims to catch*. (This doc's own §4.3 is the design-system rule; the floor lives in the milestone docs, and DR tasks inherit it.)** This rule exists because of one measured pattern in DR.1's review (R339–R344, 2026-08-18): **every claim in that PR that had been MEASURED held up** — the `next build` route-manifest diff (136 URL values + 39 static/71 dynamic entries incl. every `namedRegex`, EMPTY), the same-cookie middleware differential in both directions, the F66 404 comparison against a `main` worktree, the shell-provider enumeration — several of them in more detail than they were written up with. **Every claim that failed was the same species: an assertion about the post-change world inferred from the INTENT of the change rather than observed.** "The rename replaced two identifiers so the file is still 1013 lines" (true of the rename, false of the commit — it was +22). "The other arms have buttons, so no state is a dead end" (four arms checked, two never enumerated — both had no exit at all). "The false docblock claim WAS corrected" (one of its two false sentences was). "`route-groups.test.ts` pins that" (pin written, path recalled — it is `src/lib/`, not `src/app/app/`). "Replayed with the identical cookie" (named in the helper, never delivered to `request.cookies`). Each was written in the *proved* register beside claims that genuinely were proved, and inherited their credibility; **each was one `grep`, one `wc -l`, or one DOM inventory away from being caught.** So, concretely: a sentence of the form *"X still lands"*, *"Y is not a dead end"*, *"Z was corrected"*, *"the pin covers it"* is **not shippable without the command or measurement beside it** — in the PR body, the docblock, or the PROGRESS entry. Prefer citing by **symbol** over line number where you can; a symbol survives the next edit. If you cannot cheaply establish it, write what you actually know ("not checked") — a hedge is free and a false disclosure costs the next Builder a day.

Seven more join them for this lane:

10. **NAME THE PARTY BEFORE YOU BUILD THE PROTECTION (D226).** A mock has one human and eleven bots. **A task that adds isolation, an authority check, an audit trail or a containment mechanism must name who it protects whom from** — and *"a user from breaking their own practice"* is a valid answer while *"the leagues code does it this way"* is not. **This rule is the whole point of the rewrite** and a diff that reintroduces league-shaped machinery without an answer has missed it.
11. **REAL LEAGUES AND REAL DRAFTS DO NOT CHANGE. AT ALL.** No diff whose effect is visible on a real league's seat map, member list, capacity, settings, recap, or on an `is_mock = FALSE` draft. `add_placeholder_seat`, `create_league`, `draft_start` and the league recap keep their shipped behaviour byte-for-byte and their pgTAP pins pass untouched. **Where MP.1 chooses a same-tables shape, this rule is the gate on every RLS and in-body change it implies** (D233(5)).
12. **SETTINGS ARRIVE AS AN OBJECT; THE SOURCE IS THE CALLER'S BUSINESS (D229(5)).** No MP task may build the settings path such that values can only come from a template. **League inheritance must later be a new source, not a rewrite.** A launch RPC that looks up a template internally has broken this rule.
13. **THE FLAG GATES SURFACES, NOT SERVER AUTHORITY** (D231(4)). No `featureFlags.*` read in a route handler's authorization path, in a service-layer gate, or anywhere a SQL function's behaviour depends on it.
14. **THIS IS LAUNCH-FACING WORK (ruling 9 of the brief; CLAUDE.md's 2026 go-live block).** Chris intends to invite users to it. **Loading, empty, error and overflow states are in scope for every surface**, in the redesign's language, at the level `docs/design/lists/README.md` and the design-fidelity skill require. *(This does not license explanatory copy — rule 16.)*
15. **THE DRAFT-ROOM LAYOUT IS PARKED AND THIS LANE DOES NOT MOVE IT.** DR2 (PR #180) is the layout rework, awaiting Chris's Figma. MP surfaces work **within** existing structures — the Home chip row, the shipped recap components, the two existing More lists. **MP.6 is a ROUTE move, not a layout move, and says so.** If a Builder needs a new region, a resized zone or a new breakpoint, **stop and flag it**: that is a DR2 question.
16. **NO NEW EXPLANATORY COPY**, inherited rather than re-decided (MS §3 ruling 3 / D221(1)). Labels say what a control does; a column header names its column; an empty state says what is empty and what to do. No tutorial, no onboarding hint, no first-run tip, no "what is a mock draft" explainer.

---

## 5. Task list (one Builder session each; ≤ half a day)

Every task: branch from up-to-date `main`, **one task one PR, do not merge**. Migration and pgTAP numbers are **expected** — confirm the real next-free at task time (§1.10).

**Eleven tasks. Three are server** (MP.2 the config fix, MP.3 the standalone mock, MP.4 the settings), **one is an investigation** (MP.1), **six are surfaces** (MP.5–MP.10), **one is the closing sweep** (MP.11). **MP.1 comes first and decides the shape the rest is built on.**

---

### MP.1 — The storage investigation: can the engine serve a league-less mock without duplicating itself? *(no behaviour change)*

> Read **D233**, **D226**, this doc **§1.2, §1.3**; spec **v2.16 §8.8**; `tasks-M3` §4 rules 1–8; MS.1's charter (an audit task ships a decision, not a change). **Lane opener — nothing else in MP starts before its answer exists.**

1. **The question, stated so it can be answered wrongly:** *can the draft engine operate on mock-owned storage without duplicating the auction/snake logic?* **If reuse means two copies of the auction rules, that is worse than either option and the task must say so plainly rather than proceeding.**
2. **Enumerate the real coupling** rather than trusting §1.3's numbers: for each of `drafts`, `draft_picks`, `draft_bids`, `draft_queues`, `draft_liveness`, `league_chat`, list the live functions that name it and what they do with it. Re-run the counts against the deployed schema — **§1.3's figures were taken on 2026-08-21 and the migration band is contended.**
3. **Price BOTH shapes with evidence, and price them the same way.** **(a) Same tables, nullable `league_id`:** the four `NOT NULL` drops, the five RLS policy arms on four tables, the eleven in-body auth sites across eight functions, and the ownership predicate (`config->'mock'->>'launched_by'`, the `069:404–415` idiom). **(b) Mock-owned tables:** what has to be duplicated, re-pointed, or made dynamic — **with the line count**, and with an explicit statement about the `search_path=''` discipline and the pgTAP suites.
4. **Answer the question that would flip the answer (D233(5)):** does a nullable `league_id` weaken any **real-league** guarantee? Show that a policy of the shape *"member of the league OR launcher of this mock"* is **provably no more permissive** for a row that has a league — a truth-table over the arms plus a probe. **If it cannot be shown, the answer changes.**
5. **Deliverable: a decision with evidence per row, and no behaviour change.** Migration count zero. The PR body carries the recommendation and the losing option's price. **A task that investigates and builds will report on its own work** (MS.1's reasoning).
6. **DoD:** the measurements shown; `npm run test`, `npm run test:gate`, `npm run type-check` green to prove nothing moved.

---

### MP.2 — The engine reads its own config, not a league *(migration ~094)*

> Read **§1.2** — the finding — and `CLAUDE.md`'s migration discipline. **This is a prerequisite for any league-less mock AND a standalone correctness improvement for the mocks that exist today.**

1. **The defect, and the sweep that bounds it (§1.2).** **Exactly two live-draft readers, both of the same setting, and there are no siblings** — the settings-level sweep returns ten hits and the other eight are launch-time or `draft_tick`'s non-mock D94 arm:
   - **`draft_mock_cpu_need`** — head **`089_mock_auctions.sql:394`** (re-derived; 091 replaced `draft_mock_cpu_bid_value` at `091:271`, not this one). Reads `l.roster_settings->'starting_slots'` via `JOIN public.leagues l ON l.id = d.league_id`, **inside the CPU value model, on the hot path of every bid.**
   - **`draft_autopick_resolve`** — `SELECT l.* INTO v_league …` then `v_league.roster_settings->'starting_slots'`, on every autopick.
   **`create_mock_draft` never snapshots it** (`092:1219` copies `settings->'draft'`; **`roster_settings` is a separate COLUMN**), so a mock's roster shape tracks the league's *current* value — **already a live D95 *"a mock never re-hydrates"* violation for the mocks that exist today.**
2. **Why this is a correctness bug and not a NULL to defend against.** With no league to join, `draft_mock_cpu_need`'s join matches nothing, `v_slots`/`v_total` stay NULL, and **every bot's need term collapses — the bots stop bidding, or bid only on the top of the board.** A smoke test would show a mock that runs and a board that fills wrongly. **Do not "handle" the NULL; remove the read.**
3. **Snapshot the slot shape into `drafts.config` at launch** (beside the derived `total_rounds` already stored at `092:1296`), and change both readers to take it from `v_draft.config` with the league read as a fallback **only** where a league exists — or with no fallback at all if MP.1's shape makes that unnecessary. **State which, and why.**
4. **Re-verify the claim this lane rests on** once the change lands: re-run §1.2's sweep and show that **no live function on a mock's path reads league settings**. That is the assertion; the `pg_proc` query is the proof.
5. **pgTAP (~042):** a league-attached mock's roster shape is **unchanged by editing the league's roster after launch** (the D95 promise, now true); autopick and CPU-need produce identical results before and after the migration for an unedited league (**the no-change pin**).
6. **≥1 deliberate-break probe SHOWN failing and reverted** — recommended: leave one reader on the league and show the re-hydration pin go red. **A second probe is worth its cost here:** point `draft_mock_cpu_need` at a draft with no league and show the bots' need term collapsing, so the failure mode is on the record rather than in a paragraph.
7. **§4 rule 11:** a real draft's autopick behaviour is byte-identical. Its pgTAP pins pass untouched.

---

### MP.3 — A mock with no league: launch, bots, storage, cleanup *(migration ~095)*

> Read **MP.1's decision** (which is LAW for this task), **D227**, **D226**, **§1.4**. **Depends on MP.1 and MP.2.**

1. **Build the shape MP.1 chose.** Do not revisit it; if it looks wrong, **stop and say so** rather than quietly picking the other one.
2. **The launch RPC takes a settings OBJECT** (§4 rule 12 / D229(5)) plus draft type, team count, the human's slot, and CPU speed. `SECURITY DEFINER`, `search_path=''`, in-body auth, REVOKE. §22.5's caps (3 active, 5/hour, `092:1246–1266`) apply unchanged and are counted the same way.
3. **Bot seats per D227:** N−1 `teams` rows, `league_id NULL`, owner = launcher, `CPU 1…N`, recorded in `config.mock.cpu_seats`, minted in the launch transaction. **The human gets one too** — with no league there is no franchise to borrow.
4. **Close R473's wedge (D227(4)):** narrow `053`'s standalone-teams policy so a row named in a live mock's `cpu_seats` cannot be **DELETE**d. UPDATE and world-read stay, explicitly. **Pin the wedge:** attempt the delete as the owner, show it refused, and show that before the fix it succeeded and the draft stalled.
5. **Cleanup is part of this task.** `delete_mock_draft` and `mock_draft_expire` remove the draft **first**, then the `cpu_seats` teams, in one transaction, with a `league_id IS NULL` safety belt on the delete (**a malformed `cpu_seats` array must be incapable of deleting a real franchise**). **A task that creates rows and does not delete them is not done.**
6. **pgTAP (~043):** a user in **zero leagues** launches, drafts, completes and deletes a mock. A whole-schema delta over all **56** `public` tables shows changes confined to the mock's own rows and its bot seats — **no `leagues`, no `league_members`, no `league_rosters`, no `transactions`, no notification, no broadcast on any `league:<id>` topic.** Assert the fixture is non-empty first (**F94**).
7. **§4 rule 11 is the gate:** a real league's rows and a real draft's behaviour are byte-identical throughout. **Typegen:** preserve and re-append `database.ts`'s hand-written alias block; verify the diff is additive-only.

---

### MP.4 — Settings come from the base templates, and the launcher chooses them

> Read **D229** and **§4 rule 12**. **Depends on MP.3.**

1. **The six base scoring templates ship already** — ESPN Standard / Full PPR, Sleeper Standard / Full PPR, Yahoo Standard / Half PPR (migration 058). **Pick one at launch; build no new scoring content.**
2. **Draft settings default to the schema's own values and Chris's ruled numbers — which are the same thing** (§1.9): nomination **30s**, bid **20s**, anti-snipe **10s**, pick timer **90s**, `DEFAULT_ROSTER_SETTINGS`. **No mock-specific default.** Verify each against `league-settings.ts` rather than copying from here.
3. **The user changes them at launch** — *"the defaults are merely a suggestion."* Clocks, team count, roster, draft type, auction budget. **Reuse the shipped settings components** (`settings-panel.tsx` owns these controls today); a second settings editor is the LV.7 failure pattern.
4. **The deferral constraint is this task's main design obligation.** The RPC receives a settings object; the **template is one source among future sources**. Write it so *"fill this from league X"* is a new call site, not a rewrite — and **say in the PR how you know it is** (name the seam).
5. **Validate server-side** with the existing schema (`draftConfigSchema`'s ranges — `league-settings.ts:257–258`), never client-side only.

---

### MP.5 — The release gate and the practice home

> Read **D231**, `feature-flags.ts` in full. **This creates the surface MP.8 and MP.9 hang off.**

1. **`NEXT_PUBLIC_FLAG_MOCK_DRAFTS` → `featureFlags.mockDrafts`**, read literally (`:9–11`), with a docblock stating D231(2)'s release/isolation distinction. **Add it to `.env.example`.** Discharges **F103** (the stale `leagues` docblock at `:20`) — one line, in the file you are already editing.
2. **`/app/mocks`** — a user-scoped list of every mock the user launched, active and complete. Gated on `mockDrafts` **only**.
3. **The user-scoped read is new work.** `useMockDrafts` is league-keyed (`use-mock-drafts.ts:42–48`) and `listMockDrafts` takes a `leagueId` (`draft-service.ts:1411`). Add **`GET /api/mocks`** beside them, same column selection, same launcher-scoped server-side filter. **Do not widen the league route to mean "all"** — two questions, two endpoints.
4. **`MockRow` is reused, not reimplemented** (`mock-draft-launcher.tsx:284`, already mounted twice). Its league-scoped links (`:329`, `:333`) need a league-optional arm.
5. **Exits:** a standalone mock's surfaces must not offer *"Back to league"* (five links today — `draft-recap.tsx:143/235/555`, `mock-draft-launcher.tsx:103/119`). They go to `/app/mocks`. `room-exits.test.ts` and `room-entry.test.ts` pin the inventory **by count** — **re-point them, do not delete them.**
6. **States (§4 rule 14):** loading, empty ("no practice drafts yet" + the launch affordance), error. This is a launch surface.

---

### MP.6 — The mock room leaves `/app/leagues`

> Read **§1.7**, **D231(3a)**, **§4 rule 15**. **Depends on MP.5. Prerequisite of MP.7's leagues-off pin.**

1. **The defect:** `(room)/leagues/layout.tsx:18` hard-redirects **every** `/app/leagues` URL when the leagues flag is off — the room included, by design and by its own docblock — and the mock room is that route (`mock-launcher-entry.ts:18`). **`featureFlags.mockDrafts` cannot reach past it.**
2. **Give the room its own route keyed on the MOCK's id:** `/app/mocks/[mockId]` beside `/app/mocks` (MP.5) and the report (MP.8). Gated on **`mockDrafts`**, and nothing else.
3. **Re-point, do not fork:** `mockLauncherHref` (`mock-launcher-entry.ts:13–19`), `room-entry.test.ts`, `room-exits.test.ts`, and `route-groups.test.ts:223–232`, which gains the mock room's own gate assertion beside the two leagues ones. **A second room component is the LV.7 failure pattern** — this is a route move around the same component.
4. **§4 rule 15 is NOT engaged and this task says so out loud.** DR2 owns the room's **layout**; this moves the **route wrapper** (`(room)/leagues/[leagueId]/draft/page.tsx` is 20 lines and mounts `DraftRoom`). **Measured: PR #180 touches no code at all** (`git diff main...pr180 --stat` → five files, all `docs/`). If the *component* needs restructuring to serve two routes, **that** is the DR2 question.
5. **Pins:** with `leagues` **off** and `mockDrafts` **on**, the mock room renders **and** the leagues room route still redirects — both, in one test. **Show the new gate assertion RED** by pointing it at the un-gated route first.
6. **Old URLs redirect, never 404** — `?draft=<id>` room links exist in the wild (`mock-draft-launcher.tsx:333`).

---

### MP.7 — Launch a mock from Home

> Read **§3.4** (entry point one), **D229**, **D231**; **§1.5**. **Depends on MP.4** (there is nothing to launch without it) **and MP.6** (the room must be reachable with leagues off).

1. **The affordance sits in the existing Home structure** (§4 rule 15) — the natural place is `HomeQuickActions`' chip row (`home-quick-actions.tsx:47–90`), which already renders one un-gated chip beside two `leagues`-gated ones. **A new hub card is a layout decision and belongs to DR2/the Figma.**
2. **It opens the launch dialog** — MP.4's settings form — and lands the user in the room.
3. **ONE launch dialog.** `MockDraftLauncher` (`mock-draft-launcher.tsx:57`) owns the launch form today (seat `Select` `:140–155`, CPU speed `:160`, submit `:187`). **Compose it with a league-optional arm; do not fork it.** This is the one place MP and MS meet (§7).
4. **The `leagues`-off pin (D231(3)):** with `featureFlags.leagues` **off** and `mockDrafts` **on**, the chip renders, the dialog opens, the launch succeeds, **and the room loads.** **This is the assertion that makes ruling 3.8 true rather than intended.**
5. **`HomeQuickActions`' two stub chips are NOT this task's business** — they toast, they are `leagues`-gated. Note them; do not fix them.

---

### MP.8 — The Mock Draft Report

> Read **§3.5**, **D230**; **§1.6**. **Depends on MP.5** for its home.

1. **`/app/mocks/[mockId]/report`** renders the report for any mock the viewer launched. An unknown, foreign or unfinished id lands on one honest empty state — the existing recap page's no-leak posture (`recap/page.tsx:15–21`).
2. **A real table with column headers. Two column sets** (D230(2)): auction = *player · position · team · **price** · **nomination #*** plus per-team spend; snake/linear = *player · position · team · **round** · **pick #***. **Never one table with blank columns.**
3. **Compose the shipped derivations:** `recapBuysInOrder` (`draft-recap-ops.ts:157–159`) and `recapTeamSpend` (`:130–152`); add the snake sibling **in the same ops file**, pure, with colocated tests.
4. **Wide content scrolls inside its own container** — CLAUDE.md's responsive rule, the treatment `AuctionFinalBoard` already uses (`draft-recap.tsx:432–437`: `overflow-y-auto`, `role="region"`, `tabIndex={0}`, an `aria-label`). **Elevation: nothing in normal page flow is elevated at rest** — a table is not an overlay.
5. **Delete travels with the report** — `delete_mock_draft` is launcher-keyed (`071:500–504`); the UI must not offer it more widely (`recapVariant`'s `canDelete`, `draft-recap-ops.ts:39–54`).
6. **The one legacy residual (D230(4)):** mock recaps that already exist under `/app/leagues/[id]/draft/recap?draft=<mock_id>` keep working — **redirect, never 404.** `grep -rn "draft/recap" src` and move every in-app link in this PR. **The league recap for a REAL draft is untouched, and its pins pass.**
7. **States (§4 rule 14):** loading, not-found, and a mock that completed with no picks.

---

### MP.9 — Mock Drafts under More… *(both lists, and the pin)*

> Read **§3.7**, **§1.5**, **§4 rule 17** *(the nav rule — see below)*. **Depends on MP.5.**

1. **Add a `Mock Drafts` entry pointing at `/app/mocks`, gated on `featureFlags.mockDrafts`, to BOTH** `MORE_ITEMS` (`sidebar.tsx:57–74`) and `more-sheet.tsx`'s inline rows (`:35–64`). **Same label, same icon, same flag.**
2. **Do not unify the two lists.** The split is deliberate and form-factor driven — desktop's sidebar shows primaries directly (`sidebar.tsx:26–55`) with a small More; mobile's five bottom tabs push overflow into the sheet; **the same flags govern both, and Chris confirmed the production behaviour.** A PR that refactors them into one source has left this lane.
3. **The pin (F104), and it must be cheap or it will not survive.** One test asserting the two files agree about the entries common to both — the `elevation-rule.test.ts` / `draft-command-bar.test.ts:151–153` idiom (read the source text, assert against it). **Show it RED** by adding the row to one file only.
4. **The `leagues`-off pin:** with `leagues` off, More still shows My stats and Mock Drafts.

---

### MP.10 — The practice surfaces are launch-facing

> Read **§4 rule 14**, **§4 rule 16**, `CLAUDE.md`'s Redesign block, `docs/design/lists/README.md` (Geometry / elevation), and the `design-fidelity` skill. **Depends on MP.5–MP.9. A pass over what exists, not new surfaces.**

1. **Chris intends to invite users to this during the free-only 2026 launch** (*"until then we can invite users to come do mocks for practice"*). **It is not an internal tool.**
2. **Every practice surface gets its states**, in the redesign's language: loading, empty, error, and overflow/long-content. The list with no mocks; the report of a mock that ended early; a launch that failed a cap (§22.5's friendly refusals already exist — surface them, do not restate them).
3. **Elevation is a hover state, never a resting one** (CLAUDE.md). No resting shadows outside the overlay allowlist; `src/components/ui/elevation-rule.test.ts` pins the primitives.
4. **Tokens, not literals; ×0.8 scale; single blended theme.** No `dark:` variants.
5. **§4 rule 16 still holds — polish is not explanation.** An empty state says what is empty and what to do. It does not teach the user what a mock draft is.
6. **If a state needs a layout the room or the hub does not have, STOP and flag it** — that is a DR2 question (§4 rule 15).

---

### MP.11 — The closing sweep

> Read **D231(2)–(3)**, **§4 rules 10–13**. **Runs last by definition** — a verification pass over an unfinished lane verifies nothing (the MS.6 / DR.8 precedent).

1. **The independence end-to-end, in one run:** `NEXT_PUBLIC_FLAG_LEAGUES=false`, `NEXT_PUBLIC_FLAG_MOCK_DRAFTS=true`, a user in zero leagues → Home → launch → draft → complete → report → More… → delete.
2. **The isolation sweep as a permanent assertion:** the whole-schema delta over all 56 `public` tables around a standalone mock's entire lifecycle. **Framed per §4 rule 10 — it asserts that nothing leaks into the league product, not that a mock is defended against anybody.**
3. **A grep-level pin for §4 rule 13:** no `featureFlags.` read in a route handler's authorization path or a service-layer gate.
4. **Re-run §1.2's sweep** and pin it: **no live function on a mock's path reads league settings.**
5. **Name MP's suites for `L.C6.1`** — the M3 gate composes lane suites by name (F84 for AP, F90 for DR2). One line at merge; not a new F-row.

---

## 6. Deferred (not cancelled), and out of scope

### 6.1 DEFERRED — league-attached mocks. Protect this; do not design it out.

**Chris rates it highly** — *"this one inheriting your league settings is actually a really awesome feature that current platforms fail to do effectively"* — and deferred it on sequencing, not merit: *"we can get back to the league based mocks after we actually have demand for the league product itself."*

- **What is deferred:** launching a mock that inherits a league's exact settings, and **MP.7's original "Practice drafting here" on League Home.**
- **What that means for the CTA that ships today:** `PracticeCta` (`league-home-states.tsx:537–553`) **stays exactly as it is, labelled `Run mock draft`, doing what it does now.** It is **not** re-labelled — re-labelling it to Chris's words while it does the deferred thing would advertise the deferred feature as shipped.
- **THE DESIGN OBLIGATION, and it is a rule rather than a note (§4 rule 12 / D229(5)): do not build the standalone version such that settings can only come from a template.** Inheritance must later be *"fill these settings from a league instead"* — **a new source, not a rewrite.** **Every MP task that touches the settings path owes a sentence about how it kept this true.**
- **§8.8's fidelity sentence stays and goes dormant** (D232(2)) — it is exactly the sentence the deferred feature will need back.

### 6.2 Out of scope, strictly

- **The draft-room layout rework** — **DR2**, PR #180, **parked pending Chris's Figma.** MP.6 is a route move and says so; anything else stops and flags (§4 rule 15).
- **Public leagues.** Ruling 3.3 explains *why* standardized settings exist for strangers; it does not ask for public leagues, a lobby, matchmaking, or a "Scout Scoring" catalog entry. **MP uses the six shipped base templates and stops.**
- **CPU bidders driven by the AI personas — FILED AS A FAST-FOLLOW (F107), NOT BUILT HERE.** Chris: *"it would also be cool from a product standpoint if the cpu bidders were actually based on our AI personalities and their player rankings."* **It is cheap in principle and it is the one thing in this feature the incumbents cannot copy** — see F107 for the measured gaps. **This lane's bots are `CPU 1…N` on the shipped ADP model** (D227(5)), and a task that starts *"while we're minting the bot seats…"* has left the lane.
- **Emailing the results.** *"it emails you the draft results"* is an observation about the incumbents, not a request (D230(5)). The report has a permanent home and a list — the durable version of the same value. **A small follow-up if Chris wants it.**
- **Any change to the §8.7 commissioner surface.** That is **MS**, merged and separate (§7).
- **The commissioner PICK SWAP — F101**, real-league scope, not built here.
- **NO TRADE SYSTEM.** Not for picks, not for players, not in a mock and not in a real league.
- **Multi-human mock rooms** — §8.8's v1.1 line, untouched.
- **`commissioner_actions` audit rows** — F32/F40 stand; the table does not exist until M6. **And under D226 a solo practice has nobody to be accountable to.**
- **Unifying the two More lists** (§1.5 / MP.9 item 2) — deliberate, confirmed in production.
- **Defensive machinery for humans changing their minds or dropping connection** — the standing *"personal problem"* ruling. **R473's seat-delete guard is NOT an instance of this**: it stops a user destroying their practice irrecoverably, which is a correctness floor, not a nanny.

---

## 7. The MS relationship — the rewrite shrinks it to almost nothing

**MS keeps its narrower job and all eight of its tasks. None is dropped; one is re-scoped by circumstance rather than by decision.**

MS owns **authority inside the room** — which §8.7 commissioner controls a launcher may reach on a mock. **Under the new shape the two lanes barely touch**, because MS's entire subject matter is *a mock's relationship to the league it is attached to*, and standalone mocks have none.

| MS task | Meaning under the new shape | Consequence |
|---|---|---|
| **MS.1** — the audit (which controls pass §8.8) | **Unchanged in method; its SUBJECT is now the deferred feature.** §8.8 isolation is a statement about the real league a mock is attached to; a standalone mock has none, so **the audit only has anything to measure on league-attached mocks.** | **Still worth doing and still correct** — it is the safety work the deferred feature needs before it returns, and it found four real breaches. **Its priority drops with the feature's**; it no longer blocks anything users can reach. |
| **MS.2** — the launcher gate | **Unchanged and now MORE clearly right.** The gate is keyed on `config.mock.launched_by` and nothing else — **which is exactly D226(3)'s "one ownership predicate, not a membership graph"**, arrived at independently. Its load-bearing fix (`is_league_commish` firing before the mock refusal) applies to league-attached mocks. | **Take it as written.** MP.1 should **reuse its predicate**, not invent a second one. |
| **MS.3** — the D141 clock carve-out | **Its urgency changes.** The first cut made MS.3 the *only* remedy for a launcher stuck with their league's clock. **Under the new shape the launcher sets the clocks at launch (MP.4)**, so MS.3 becomes what it always was: a convenience for editing them mid-draft. | **Still valuable, no longer load-bearing.** |
| **MS.4** — `draft_reset` in a mock | **Unchanged, and simpler.** The whole difficulty was that a reset writes `leagues`. **A standalone mock has no `leagues` row to write**, so for those the breach is absent by construction. **The decision must still be taken against the league-attached case** — one body, and that is the binding one. | Unchanged as scoped. |
| **MS.5** — surfacing the tools | **Unchanged in substance.** One dependency inverts: the first cut had MS.5 avoiding a *"Back to league"* exit; **MP.5 and MP.6 now own the standalone exits and route**, so MS.5 simply renders in whatever room it finds. | Unchanged. |
| **MS.6** — the §8.8 harness | **Its scope narrows with MS.1's.** The harness measures isolation from a real league; standalone mocks have none. **MP.11's sweep is a different assertion** — *nothing leaks into the league product* — and should NOT be merged into MS.6's. | **Two harnesses, deliberately**, and MP.11 says why (§4 rule 10). |
| **MS.7** — the order edit targets the mock | **Unchanged and still required.** The mis-target (`patchDraftOrder` resolving `.eq('is_mock', false)`) is a league-attached bug; a standalone mock has no real draft to hit. **Its hard ordering constraint with MS.5 is unaffected.** | Unchanged. |
| **MS.8** — choose your slot at launch | **This is the one real seam, and the new shape makes it MORE important.** D223's slot picker writes the mock's own order with the other franchises shuffled around the launcher — **for a standalone mock those are MP.3's bot seats, and slot choice is now part of the launch form MP.4 builds.** | **ONE launch dialog and ONE launch RPC.** Whichever of MP.4 / MS.8 lands second **composes** — it does not fork the form and does not add a second RPC. **This is the lane's only cross-lane constraint.** |

**Two recommendations for Chris, recorded not applied** (`ACTIVE-BUILD.md` is contended with #180 — **F102**):

1. **The mock track should run ahead of the league lanes, not behind them.** MS currently sits behind AP in loop step 1b. **Chris's ruling makes the mock the thing users are invited to during the 2026 launch** (*"until then we can invite users to come do mocks for practice"*) while league work waits for demand. **Recommend: `MP.*` takes precedence, `MS.*` follows it, and both sit ahead of `AP.*`/`L.C*`/`SE.*`** — with the honest caveat that **MS.1/MS.4/MS.6 serve the deferred feature** and could reasonably be parked with it.
2. **MS should not move wholesale behind `mockDrafts`.** MS.1–MS.4 and MS.6–MS.8 are SQL and service-layer work; a `NEXT_PUBLIC_` flag on a `SECURITY DEFINER` RPC is a client-side gate on server authority (§12). **Only MS.5's surfacing rides the flag.**

---

## 8. Q23, AP.4 and the 45-minute bar — what became of each

**Q23 LAPSES. It is not answered, and saying it was would misdescribe what happened.** The question — *"does the 10-second mock bid clock override a league that chose its own?"* — **has no subject in the new shape.** There is no league to inherit from, and Chris ruled there is **no mock-specific default to override with**: *"the default clock time shouldn't change for mocks … Use the same default."* **The design changed underneath the question.**

**§8.8's fidelity sentence is untouched and dormant** (D232(2)). *"A mock is slow when the league's clocks are slow, and that is correct"* is a statement about a league-attached mock; there are none for now, and it is exactly the sentence the deferred feature will need back. **Not amended, not weakened, not deleted.**

**AP.4 has nothing left in it.** Chris ruled the three numbers directly — **nomination 30s, bid clock 20s, a bid under 10s resets to 10s** — and **all three are the shipped values** (§1.9: 9 occurrences all 20; 8 all 30; anti-snipe default 10). **Zero lines change**, and the override that was AP.4's whole remaining content no longer exists as a concept. **B5 clears.**

**AP.4's record is NOT edited by this PR.** Its disposition is escalated (the reviewer's R472) and a lane document must not close another lane's task by assertion. **F106** files the obligation with a named actor, and now carries Chris's ruling as its evidence.

**F85 is DE-TARGETED — Chris's ruling, not an Architect's read.** *"My point about finishing a mock in 45 minutes was just an example not a target because previously it was 3 hours which basically makes it useless. with all the other fixes we've put in I think we're good."* **The under-45-minute bar stops being a gate.** The spec's acceptance-criteria sentence is amended accordingly (§10 item 1), and **no MP or AP task is measured against it.**

**F92 survives on its own merits, and its framing changes.** The CPU nomination still rides the 5-second sweep — **measured at 13m17s on the default shape by the AP.4 session** — and that is a real pacing cost worth fixing. **It is no longer "the other term in a bar we must hit."** It is a thing that makes practice nicer.

---

## 9. Sequencing

```
MP.1 (the storage investigation — decides the shape)          ← lane opener, nothing skips it
  ├─→ MP.2 (~094: the engine reads its own config)            ← the §1.2 finding; also fixes today's mocks
  │     └─→ MP.3 (~095: standalone mock — launch, bots, cleanup)
  │           └─→ MP.4 (settings from the base templates)
  │                 └─→ MP.7 (launch from Home)  ←─── also needs MP.6
MP.5 (the mockDrafts flag + /app/mocks + the user-scoped list) ← independent; unblocks four surfaces
  ├─→ MP.6 (the room leaves /app/leagues)  ────────────────────┘
  ├─→ MP.8 (the report: one table, two column sets)
  └─→ MP.9 (Mock Drafts under More… — BOTH lists + the pin)
                          MP.10 (launch-facing states + polish)  ← after the surfaces exist
                          MP.11 (closing sweep)                  ← last, by definition
```

- **`MP.1` is first and nothing skips it.** It is an investigation with no behaviour change, and every server task is built on its answer.
- **`MP.2` is worth taking even if MP.1's answer surprises everyone** — the roster-shape read is a live D95 violation for the mocks that exist today, independent of the new shape.
- **`MP.5` may start immediately** and in parallel with the server chain; it unblocks MP.6, MP.8 and MP.9.
- **The migration lane is serialized** (delivery plan §2.2): `MP.2` → `MP.3`, each `CREATE OR REPLACE` authored against the chain HEAD's **file text** (D137/CLAUDE.md).
- **One hard ordering constraint: `MP.6` before `MP.7`'s leagues-off pin.** Until the mock room has a route outside `/app/leagues`, that pin cannot pass (§1.7 / D231(3a)).
- **`MP.10` after the surfaces exist; `MP.11` last** — a verification pass over an unfinished lane verifies nothing.
- **One cross-lane seam: `MP.4` and `MS.8`** both touch the launch form and the launch RPC. **Neither forks; whichever lands second composes** (§7).

**Where MP sits relative to the other lanes:**

- **MP is a peer of `AP.*`, `MS.*`, `DR2.*` and `SE.*` and blocks none of them.** **Recommendation (§7): the mock track runs AHEAD of the league lanes**, because it is what users are invited to during the 2026 launch while league work waits for demand. **Filed as F102, not written into `ACTIVE-BUILD.md` here.**
- **Shared surfaces:** `PROGRESS-leagues.md` (append-collisions at merge), the migration/pgTAP band (§1.10), `MockDraftLauncher` + the launch RPC with MS.8, and `draft-recap*` with nothing in flight.
- **MP must land before `L.C6.1`** — the M3 gate composes lane suites by name. MP.11 item 5 carries the enumeration; not a separate F-row.

---

## 10. Open items (not tasks — recorded so they are findable)

1. **The spec fold, exactly.** §8.8's **Launch** bullet is amended (a mock is standalone; unfilled seats are no longer a concept because there is no league; settings come from the base templates); §8.8's **v1 scope** bullet is amended (**a standalone mock is v1**; **league-attached mocks are DEFERRED, not cancelled**; multi-human rooms stay v1.1); the **45-minute acceptance-criteria sentence is de-targeted** per ruling 3.11; a new **v2.16 block** states the rulings, the report, the report's home, the release independence, and **why the inherited threat model does not apply**; §19.2 gains **E78–E80**. **§8.8's fidelity sentence and its zero-side-effects rule are NOT weakened** — the first goes dormant with the deferred feature, the second keeps its full force for league-attached mocks. **§8.7 is untouched** (MS's fold, merged at v2.15). **§16 is deliberately NOT edited** — PR #180 rewrites §16.4, and MS set the precedent of keeping route naming inside the §8.8 block.
2. **Withdrawn by the rewrite, kept as record rather than deleted:** **D228** (the practice container — with its corrected figures, §1.3/D228(3)); **F105** (its enumeration obligation; number retired, not recycled); the invented **"Scout Scoring"** preset (§1.8 — the six base templates already ship); the **10-second mock bid clock** (D229(3) — *"Use the same default"*); and the **mock-report/league-recap route split** as a task (D230(4) — one legacy item inside MP.8 instead). **A withdrawn decision that leaves no trace is how a rejected design gets re-proposed as a fresh idea.**
3. **Merge conflicts, per file and per resolution.**
   - **#180, spec `**Version:**` line** — `2.16` vs `2.14`. **A single-value header cannot be "keep both": TAKE THE HIGHER**, and let the changelog carry both entries.
   - **#180, changelog head and §19.2's tail** — append-shaped (DR2 appends E71–E74; this PR appends E78–E80). **Keep both, in order.**
   - **#180, §8.8** — no conflict expected; DR2's nearest spec hunk was measured during the MS session at `@@ -570,14 @@`, which is §8.9. **Re-measure at merge rather than trusting that number.**
   - **#186, `PROGRESS` §4 and §7** — append-shaped. **Keep both.**
   - **#186, `PROGRESS` §5 — a CONTRADICTORY REPLACEMENT, not an append.** #186 asserts B5 as standing; this PR says it is cleared. **Both cannot stand — decide one.** The question B5 stands on has lapsed, so **this PR's text wins whichever merges second.**
   - **#186, `ACTIVE-BUILD.md` loop step 1a** — #186 rewrites it to *"blocked on Q23"*, which is stale the moment Q23 lapses. **F102's fix shape covers it.**
4. **`ACTIVE-BUILD.md` is untouched by this PR and that is deliberate** — **F102**, the F98 precedent, with a named actor.
5. **Not proposed, and recorded so it is not re-proposed as an oversight.** (a) *A mock-scoped shadow of `league_members` or `teams`* — rejected by MS §10 item 4 for its own reasons, and now moot. (b) *A `mock_seats` table with a `draft_picks.team_id` FK change* — a schema change to the most-written table in the build, to avoid a nullable column that already exists. (c) *Emailing the results* — §6.2. (d) *A "quick mock" that skips persistence* — Chris asked for a report that lasts. (e) *Keeping the practice container "just in case"* — a mechanism with no current requirement is a mechanism nobody maintains.
6. **A note for whoever writes `L.C6.1`:** MP.11's whole-schema sweep is the natural home for any future *"does practice leak into the league product"* question. Name it in the gate.

---

## 11. Open questions

**Q24 — where do mock reports live: a PRIVATE app surface, or the user's PUBLIC profile?** *(filed 2026-08-21 by the MP Architect session. **NON-BLOCKING** — every task ships the recommendation, so a ruling the other way is a route move and a visibility predicate, not a redesign.)*

**Why it is a question.** Chris's two rulings point at two different places and both are reasonable readings. *"mocks should go to something on the **User's profile**, not at the league level"* — and FieldScout profiles are **public, server-rendered** surfaces (`/u/[username]`; CLAUDE.md's SEO rule; the More sheet's own *My profile* row links there, `more-sheet.tsx:101–107`). But also *"under the **More...** section there can be a Mock Drafts tab"* — private app chrome. **A mock report shows your strategy** — which players you paid up for, where you reached — and that is competitive information a league-mate could read the week before draft night.

**Options.** **(a) Private only** — `/app/mocks` + `/app/mocks/[id]/report`, reachable from More…, scoped to the launcher. **(b) Public profile tab** — `/u/[username]/mocks`, server-rendered, world-readable. **(c) Private by default with an explicit per-report share.**

**Recommendation: (a).** It satisfies the More… ruling exactly and satisfies the profile ruling's *intent* — the reports belong to the **user**, not to a league, which is the contrast that ruling was drawing (*"However, real drafts should have a place at the league level"*). It needs no new visibility decision: `delete_mock_draft` is already launcher-keyed (`071:500–504`). **(c) is a cheap follow-up from (a)** — a column and a predicate — whereas **(b) makes every past practice public by default**, which nobody asked for and cannot be walked back for reports already published. *(If Chris wants the emailed results of D230(5), (c) is the shape that gets there.)*

---

## 12. Ledger dispositions (swept 2026-08-21, re-swept after the rewrite)

| Row | Disposition in MP |
|---|---|
| **F32 / F40** — `commissioner_actions` until M6 | **Unchanged and untouched.** MP adds no commissioner control and no audit surface — **and under D226 a solo practice has nobody to be accountable to.** |
| **F41** — §22.5 rate limits | **Unchanged, and it now binds the standalone launch path** — the same 3-active / 5-per-hour caps, counted the same way (`092:1246–1266`). **No new rate-limit surface**; a Builder who adds one has changed §22.5 without a ruling. |
| **F76 / F92** — CPU pacing | **F76 closed (AP.3). F92 untouched, and its FRAMING changes:** with F85 de-targeted, F92 is a real pacing cost worth fixing (13m17s on the default shape, measured by the AP.4 session) rather than a term in a bar. |
| **F85** — the §8.8 under-45-minute bar | **DE-TARGETED by Chris, 2026-08-21** (§8 / D232(5)): *"just an example not a target … I think we're good."* **It stops being a gate**, the spec sentence is amended, and no MP or AP task is measured against it. |
| **F94** — the local player pool is empty after a `db reset` | **Unchanged, and it bites every MP pgTAP suite.** Each **asserts its fixture is non-empty before asserting anything about it** — CLAUDE.md's "nothing happened means it worked" rule, of which F94 is an instance. Not discharged here. |
| **F98** — the MS lane clause in `ACTIVE-BUILD.md` | **Discharged 2026-08-21 by `1d4620d`** (verified: `main`'s `ACTIVE-BUILD.md` carries the MS rows and loop step **1b**), **and this PR flips its §6 status cell, which was left `⬜ Open`** (R475). Named because **F102 is the same obligation for MP.** |
| **F101** — the commissioner slot SWAP | **Unchanged, real-league scope, out of MP (§6.2).** |
| **F102** | **MP has no `ACTIVE-BUILD.md` lane clause, so `/build-next` cannot take `MP.*`.** Not written here: **PR #180 rewrites the same block and the loop-order list** (F98's reason, proven — F98 needed its own follow-up commit). **Fix shape:** one lane block, one loop-order step for MP, **and a repair of loop step 1a** (which #186 rewrites to *"blocked on Q23"* — stale the moment Q23 lapses). **Plus the §7 recommendation that the MOCK TRACK runs AHEAD of the league lanes**, since it is what users are invited to during the 2026 launch — **Chris's call.** **Discharged by a NAMED ACTOR: whoever merges this PR, as a follow-up commit on `main` BEFORE the next `/build-next` cycle.** |
| **F103** | **`featureFlags.leagues`' docblock describes a world that ended at M1** — `feature-flags.ts:20` reads *"mock-data UI, no backend yet"*. Noticed while reading the file for §1.7 and **not** drive-by fixed. **Discharged by MP.5**, which is already editing that file. One line. |
| **F104** | **The two "More" lists are independently authored and nothing couples them.** `sidebar.tsx:57–74` (`MORE_ITEMS`; `grep -n "MORE_ITEMS" -r src` → 3 lines, all in that file) and `more-sheet.tsx:35–64`. **The split itself is deliberate and form-factor driven and is NOT a defect** — the defect is that **an edit to one silently misses the other with no type error and no test to catch it**. **Fix shape:** one cheap source-text pin in the `elevation-rule.test.ts` / `draft-command-bar.test.ts:151–153` idiom. **Do not unify the lists.** **Discharged by MP.9**, which edits both and shows the pin RED. |
| ~~**F105**~~ | **WITHDRAWN with D228.** Its entire content was the practice container's league-enumeration obligation, and there is no container. **The number is retired, not recycled** — a withdrawn row that vanishes is how a rejected design returns as a fresh idea. |
| **F106** | **F92's discharger cell names `AP.4`, and §8 rules AP.4 has nothing left to build — so on that ruling it goes ownerless (R474).** *(F85's cell named AP.4 too; that half is resolved differently — Chris **de-targeted** F85 outright, so its obligation dissolves rather than moving.)* **This PR deliberately does NOT re-point them** — AP.4's disposition is escalated, and re-pointing here would settle by edit a question that is open by escalation. **Fix shape:** flip F85 to de-targeted with Chris's ruling as its evidence; re-point F92's discharger to a follow-up of its own rather than to a closed task; and mark AP.4's checklist row. **Discharged by a NAMED ACTOR: whoever applies Chris's AP.4 ruling, in the same commit as AP.4's checklist row** (F102's actor if the same person). Filed because **R51** makes an unrecorded hand-off a finding in itself. |
| **F107** *(NEW)* | **CPU bidders driven by the AI personas and their real rankings — a FAST-FOLLOW, filed with its gaps measured.** Chris: *"it would also be cool from a product standpoint if the cpu bidders were actually based on our AI personalities and their player rankings."* **Why it is cheap in principle:** `draft_mock_cpu_bid_value` (head **`091:271`**) takes **`p_adp_rank` as a PARAMETER** — full identity args `(p_draft_id, p_nomination_seq, p_team_id, p_pass, p_adp_rank, p_budget, p_slots, p_teams, p_need)` — so **pointing each bot at a different board changes the INPUT, not the model**, the same shape as templated settings (D229(5)). **Why it is worth doing:** the mock stops being eleven seats called `CPU 1…CPU 11` and becomes **eleven named opponents with genuinely different boards — differences that show up as BEHAVIOUR rather than flavour text.** **The data model already exists:** `persona_source_rankings` (`ai_persona_id`, `position`, `scoring`, `raw_rankings` JSONB of `[{rank, player_name, team}]`) and `ai_personas` (`username`, `display_name`, `avatar_url`, `style_profile` JSONB — *"structured tendencies (voice, biases, leans)"*). **Measured gaps, not guessed:** **(1) A NAME→ID RESOLVER ALREADY EXISTS AND MUST BE REUSED, NOT REWRITTEN** — `raw_rankings` keys on `player_name`, and `resolveGeneratedPlayers` + `normalizeName` (`src/lib/claude/player-packet.ts:264–300`, under the heading *"Name → player_id resolution … never trust model-produced IDs"*) already does exactly this job for AI list generation (`src/app/api/lists/generate/route.ts:269`), **and it reports an `unresolved` list rather than dropping silently** — which is also the fallback discipline this row needs. *(A second `normalizeName` exists at `src/lib/sync/auction.ts:40`, matching on `name|position`; the duplication is pre-existing and is not this row's to fix.)* **(2) Seat assignment**, and **the fallback when a persona has no ranking for a nominated player — which must NOT silently become value 0**, because that is exactly how the K/DST behaviour of **F108** happens, and there by accident. **(3) LOCAL DATA IS EMPTY** — measured on the restored local stack: `ai_personas` **0 rows**, `persona_source_rankings` **0 rows** (`players` **1075**). **So the seed path working is part of this row's cost**, not an assumption. **(4) `style_profile`'s "leans" driving AGGRESSION** — a bot that reliably overpays for its favourites — is explicitly a **SECOND** version. Said out loud so nobody builds a personality engine. **Framed under the standing "AI is fun, not perfect" rule: these bots need to feel like people with opinions, not to be accurate. No accuracy work is specced.** | Chris, 2026-08-21 | **A follow-up task after the MP lane lands** — it needs a working mock to be interesting, and MP.3's bot seats are the seam it plugs into | ⬜ Open |
| **F108** *(NEW — a KNOWN BEHAVIOUR, deliberately not changed)* | **Mock CPU bots never bid on kickers or defenses: `draft_mock_cpu_need` returns 0 for `K` and `DST` outright** (`089:394`'s head — the position guard is the function's first branch, `IF v_pos IN ('K','DST') THEN RETURN 0`). Since need is a multiplier in the value model, **those positions always go for $1 to whoever nominates them.** **Defensible, and it matches how real drafts treat them** — nobody bids up a kicker — **but it is a HARD RULE rather than emergent behaviour**, and the consequence is that **a human cannot practise a bidding war on K or DST at all.** Filed so Chris does not discover it by surprise in a mock he is showing someone. **Not changed by this lane, and no task may change it without a ruling** — it is a product call about what practice should cover, and the cheap version (a small non-zero need instead of a hard 0) would change every K/DST price in every mock. *(F107's fallback design must not reproduce this shape by accident: an unresolved persona ranking becoming value 0 is the same bug arrived at without the reasoning.)* | measured 2026-08-21, MP Architect | **A ruling from Chris, if he wants it changed** — otherwise it stands as documented behaviour | ⬜ Open (informational) |
| **B5** — AP.4 blocked on Q23 | **CLEARED.** **Q23 lapsed** — the design changed underneath it (§8). **PR #186 is a documentation-only halt record and should be resolved as lapsed rather than left standing on a question that no longer has a subject.** |
| **Q17 / Q18 / Q22** | **Untouched.** Q17's numbers are re-confirmed as shipped (§1.9) and nothing reopens it. Q18 and Q22 are non-blocking and belong to their own lanes. |
