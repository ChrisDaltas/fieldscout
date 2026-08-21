# Task breakdown: MP — a mock draft is for practicing

**Lane:** MP (`MP.*`) · **Architect session 2026-08-21** · **Spec fold: `spec-redraft-leagues.md` v2.16**
**Input:** seven rulings Chris made in-session on 2026-08-21 (§3), after a practice draft refused to start in his own app.
**Base:** `main` @ **`1d4620d`** (the MS lane-clause chore). AP.1/AP.2/AP.3 are merged (migrations 091/092/093); the MS breakdown merged as **`4bd8690`** (spec **v2.15**, D216–D223). **Two PRs are open and both hold ledger numbers** — **#180** (DR2: D204–D212 / F87–F91 / Q19–Q21 / E71–E74) and **#186** (the AP.4 halt: D224 / Q23 / B5). R312 first-filed-keeps, so this lane takes numbers above all three (§1.9).
**Status:** authored — **awaiting Chris's approval of this PR. Nothing here is built until it merges** (the #150 / #155 / #161 / #178 / #184 precedent).

> **THIS LANE EXISTS BECAUSE A PREMISE IN THE SPEC IS WRONG.** Read that sentence first and let it govern the rest of this document.
>
> §8.8 has said since v2.3 that a mock is *"solo practice under the league's real settings"*, launched *"from a pre-draft league"*, with a **v1 scope of "league-attached only"**. Every mechanism below it follows honestly from that premise: the config is snapshotted off `leagues.settings->'draft'`, the seat map must be complete because the order needs every seat, the room lives under `/app/leagues/[leagueId]/…`, the recap is a league page, and the list of your mocks is keyed on a league id.
>
> **The premise is wrong, and Chris said so plainly:** *"a user may run a mock draft without even being 'in a league'. i'm not sure why you are so focused on making a mock draft connected to a specific leagues settings."* **Practice is the purpose. A league is optional context that makes practice better.**
>
> **The failure that told on it is more instructive than the correction.** Chris ran a practice draft in his own league and got *"practice draft failed, it says i need 11 more people"*. That is not a bad error message and not a missing UX affordance — it is **the architecture answering exactly as designed**, and the design was answering the wrong question. **A mock never refuses to start for want of humans. Empty seats become CPUs.** MP.1 does this first, because it is a live bug with Chris's name on it.
>
> **What is NOT overturned: §8.8's zero-side-effects rule.** A mock still writes nothing to the real league. This lane widens what a mock *is*; it does not touch what a mock may *do* to a league it is attached to. Every task is gated on that (§4 rule 10), and §7 says exactly how it composes with the merged MS lane.
>
> **The spec is LAW.** Where this document and v2.16 disagree, v2.16 wins and this document gets corrected.

---

## 1. Surveyed facts (2026-08-21; every load-bearing fact opened and read on `main` @ `1d4620d`, or measured against the deployed schema)

Cited by symbol where a symbol exists, with a line number for the exact clause so the claim is checkable and a symbol beside it so the citation survives the next edit. Where a fact was measured rather than read, **the command is named**. Three lanes running concurrently have each caught the previous breakdown citing a stale range; nothing below is copied from another document.

### 1.1 The refusal Chris hit, opened at its head

- **`create_mock_draft`'s HEAD is `092_auction_reserve_toggle.sql:1128–1422`**, with `REVOKE EXECUTE … FROM PUBLIC, anon` at `1424–1425`. Resolved with `for f in supabase/migrations/*.sql; do grep -qE '^CREATE (OR REPLACE )?FUNCTION +(public\.)?create_mock_draft\(' "$f" && echo "$f"; done` → **071 → 089 → 092**, so 092 is the head (D137/CLAUDE.md: author against the head's file text, never `pg_get_functiondef`).
- **Signature:** `create_mock_draft(p_league_id UUID, p_human_team_id UUID DEFAULT NULL, p_cpu_speed TEXT DEFAULT 'realistic', p_action_id UUID DEFAULT NULL) RETURNS JSONB`, `SECURITY DEFINER`, `SET search_path = ''` (`092:1128–1137`). **`p_league_id` has no default — a league is mandatory at the signature.**
- **The seat refusal is `092:1232–1240`**, the D103(1) block:

  ```sql
  SELECT count(*) INTO v_active_count
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF v_active_count <> v_league.team_count THEN
    RAISE EXCEPTION
      'create_mock_draft: league % has % of % franchises seated — a mock drafts the full board, so every seat must exist; add placeholder seats for the empty slots (League home → Invite) (§8.8/D103)',
      p_league_id, v_active_count, v_league.team_count
      USING ERRCODE = 'P0001';
  END IF;
  ```

  Its comment states the reason and the reason is real: *"the full seat map must exist (`draft_picks.team_id` is NOT NULL and the order needs every seat) — the D96 mirror."* **This is the architecture, not a bad gate**, and MP.1's job is to satisfy the constraint rather than to relax it.
- **The remedy the message names is unreachable for most of the people who hit it.** `add_placeholder_seat` (`063:380–477`) refuses a non-commissioner twice — a pre-lock `is_league_commish` fast-fail at `063:404–407` and an R93 re-gate under the league lock at `063:428–433`. So a plain manager in an under-filled league is told to add seats **and cannot**. That doubles the severity of the bug and is why the fix belongs in `create_mock_draft` rather than in a friendlier error.
- **Three other refusals sit in the same function and are all CORRECT — do not touch them:** the pre-draft-league gate (`092:1208–1214`), the §22.5 caps (3 active mocks `092:1249–1256`, 5 creations/hour `092:1258–1265`), and the §8.6.8 auction-solvency backstop (`092:1400–1411`).

### 1.2 The settings snapshot — the exact line that makes a league-less mock impossible today

- **`092:1219`** — `v_config := COALESCE(v_league.settings->'draft', '{}'::jsonb);` with the D95 comment above it: *"snapshot the REAL config at launch — a mock never re-hydrates."* This is the single statement Chris's ruling 1 is about: **the mock has no settings of its own; it borrows a league's.**
- **There is no fallback path.** `leagueSettingsSchema.parse({})` fills every default (`league-settings.ts` — `auction_nomination_seconds` `.min(10).max(120).default(30)` at `:257`, `auction_bid_seconds` `.min(10).max(60).default(20)` at `:258`, `pick_timer_seconds` `z.literal(PICK_TIMER_SECONDS).default(90)` at `:244`), so `leagues.settings->'draft'` always carries a full block. **A mock's settings are therefore always someone's league's settings** — which is exactly right for a league-launched mock (ruling 4 calls that *"a really awesome feature"*) and impossible for a Home-launched one.

### 1.3 The schema is league-shaped all the way down — the measurement that decides MP.2's shape

This is the load-bearing survey of the lane, and it was taken because the obvious design ("make the league optional") is much more expensive than it looks. Every `NOT NULL` below was read in the DDL and re-checked for a later `ALTER` (`grep -rn "ALTER COLUMN league_id\|ALTER COLUMN team_id" supabase/migrations/*.sql` → **no matches**, so none was ever relaxed).

| Column | DDL | Consequence for a league-less mock |
|---|---|---|
| `drafts.league_id` | `UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL` — `065:110` | a mock row cannot exist without a league |
| `draft_picks.league_id` | same shape — `065:157` | no pick can be recorded |
| `draft_picks.team_id` | `UUID REFERENCES teams(id) NOT NULL` — `065:160` | every seat needs a real `teams` row |
| `draft_bids.league_id` | `NOT NULL`, comment *"stored for a simple RLS policy"* — `083:117` | no bid can be recorded |
| `draft_bids.team_id` | `UUID REFERENCES teams(id) NOT NULL` — `083:120` | same seat requirement |
| `draft_queues.team_id` | `UUID REFERENCES teams(id) ON DELETE CASCADE NOT NULL` — `065:193` | the queue is seat-keyed |
| `league_chat.league_id` | `UUID REFERENCES leagues(id) ON DELETE CASCADE NOT NULL` — `001:529` | the mock room's chat has no home |

- **RLS is league-keyed on every one of them.** `drafts` SELECT = `is_league_member(league_id)` (`065:137–138`); `draft_picks` the same (`065:173–174`); `draft_queues`, `draft_bids` and `league_chat` follow the same pattern. **Measured:** `CREATE POLICY … is_league_member` appears **13** times across the migration tree (`grep -rn "CREATE POLICY" -A 3 supabase/migrations/*.sql | grep -c "is_league_member"`).
- **In-body authorization is league-keyed too, at scale.** `grep -roh "is_league_member(" supabase/migrations/*.sql | wc -l` → **50 call sites** across **18** migration files. Each is a `SECURITY DEFINER` authorization gate; each would need a null-league arm if `league_id` became nullable, and **each one is a place where a mistake is an authorization hole rather than a bug**.
- **A placeholder seat is a REAL league write and therefore cannot be the CPU mechanism.** `add_placeholder_seat` inserts a `teams` row (`063:455`) **and** a `league_members` row (`063:461`) into the real league. Calling it from `create_mock_draft` to fill a mock's empty slots would breach §8.8's zero-side-effects rule by construction — it changes the league's seat count, its member list, and the capacity predicate every other seat RPC re-reads (D47/F28's ONE predicate, at `063:444–449` and three sibling sites).
- **`teams.league_id` is NULLABLE and standalone teams are a shipped concept.** `001:499` declares `league_id UUID REFERENCES leagues(id)` with no `NOT NULL`; `053:62` dropped `list_id`'s `NOT NULL` for league franchises (D35a); `053:66–71` gives standalone teams their own RLS (`auth.uid() = owner_id AND league_id IS NULL`). **A `teams` row with `league_id IS NULL` is invisible to every league-scoped predicate BY CONSTRUCTION, not by an added exclusion** — that is the property MP.1's seat primitive is built on (D227).
- **The room and the recap are league routes.** `src/app/app/(room)/leagues/[leagueId]/draft/page.tsx` and `src/app/app/(shell)/leagues/[leagueId]/draft/recap/page.tsx` (`find src/app/app -maxdepth 6 -type d | grep -i draft` → four directories, both draft ones under `leagues/[leagueId]`). The whole mock API surface is nested the same way: `find src/app/api -path '*mock*'` → `…/api/leagues/[id]/mock-drafts/route.ts` and `…/[did]/route.ts`, **and nothing else**.

### 1.4 A recap already exists — what ships, and what is genuinely missing

- **`DraftRecap`** — `src/components/draft/draft-recap.tsx` (562 lines), pure derivations split into `draft-recap-ops.ts` (159 lines), mounted at `src/app/app/(shell)/leagues/[leagueId]/draft/recap/page.tsx` (28 lines). `?draft=<id>` targets a specific completed draft in that league — **the mock path** — and its absence means the league's real completed draft (the page docblock, `:15–21`).
- **Two cards, both grouped by team.** *"Final board"* — `DraftBoardGrid` for snake/linear, `AuctionFinalBoard` for auction (`draft-recap.tsx:264–283`) — and *"Your roster vs the CPUs"* / *"Rosters"* (`:284–312`), a grid of `RecapRosterCard`s in `recapTeamOrder` (`draft-recap-ops.ts:96–118`).
- **Prices and per-team totals already exist.** `recapTeamSpend` (`draft-recap-ops.ts:135–152`) returns `{ total, biggest }` per team; `RecapRosterCard` calls it at `draft-recap.tsx:334`.
- **The auction ALREADY has a flat cut, and it is the closest thing in the app to what Chris asked for** — `recapBuysInOrder` (`draft-recap-ops.ts:157–159`) filters undone picks and sorts by `pick_number`, rendered by `AuctionFinalBoard` (`draft-recap.tsx:411–467`) as a `<ul>` of rows carrying `#{pick_number}`, position badge, player name, team name and `${pick.price ?? 0}`. **So the derivation for the auction column set exists and MP.5 must compose it, not re-solve it.**
- **What is actually missing, stated precisely:** (a) **a table** — the auction cut is a list, not a table, with no column headers and no sort; (b) **the snake column set entirely** — a snake recap gets a grid, and there is no flat "every player, round, pick number, team" cut anywhere; (c) **a non-league home** for either.
- **Delete already exists in two places.** `DeleteRecapButton` (`draft-recap.tsx:474–530`, label *"Delete recap"* at `:500`) and the launcher's row-level control (`mock-draft-launcher.tsx:343`, `aria-label={complete ? 'Delete recap' : 'Delete practice draft'}`). Both call `delete_mock_draft` (HEAD `071:469–515`), which is launcher-keyed at `071:500–504` and sweeps the mock's chat explicitly at `071:509–511` because the chat FK is to the league.
- **Persistence is therefore largely solved.** A completed mock keeps its `drafts` row and its `draft_picks` until the launcher deletes it or the 72h idle expiry fires (`mock_draft_expire`, HEAD `071:524–610`, cron scheduled at `071:622`, `'0 3 * * *'`). **The gap is a cut and a home, not storage.**

### 1.5 The entry points — one of Chris's two already exists, and this corrects the brief

- **The League Home button Chris described is already there, and it is already beside the real one.** `ScheduledHero` renders `Enter draft lobby` at `league-home-states.tsx:463–468` and **`<PracticeCta leagueId={leagueId} />` immediately after, at `:468`**, in the same `flex flex-wrap items-center gap-2.5` row. `SetupHero` renders it too (`:326`), under a comment recording Chris's earlier ruling that practice is available from league creation. `draft-lobby.tsx:251` is the third mount (§16.5.2's *"Practice card · draft lobby"*).
- **Its label is `Run mock draft`, not "Practice drafting here"** (`league-home-states.tsx:537–553`; the disabled branch at `:539–545` is dead now that `MOCK_LAUNCHER_READY = true` — `mock-launcher-entry.ts:10`). **So MP.7 is a copy-and-placement task plus a flag-degradation task, not a new button**, and saying otherwise would have had a Builder build a fourth CTA beside three that already exist.
- **The Home-tab entry point is genuinely new.** `src/app/app/(shell)/page.tsx` composes `PageHeader` + `HomeQuickActions` + `YourLeagues` + the right-hand cards; `HomeQuickActions` (`src/components/home/home-quick-actions.tsx`) holds three chips — **Join** and **League**, both `featureFlags.leagues`-gated and both still `toast()` stubs (`:52–80`), and **List**, which opens the real dialog (`:82–88`). **There is no mock affordance on Home at all** — `grep -rn "mock" src/components/home/` returns nothing.
- **`useMockDrafts` is LEAGUE-SCOPED and cannot back a user-wide list.** `src/hooks/use-mock-drafts.ts:41–48` — key `['mock-drafts', leagueId]`, fetching `/api/leagues/${leagueId}/mock-drafts`; the service is `listMockDrafts` at `src/lib/leagues/api/draft-service.ts:1411`. **A "all my past mocks" surface needs a new user-scoped read**, not a parameter change.

### 1.6 The two "More" lists — deliberate, not drift

- **`MORE_ITEMS` is `src/components/layout/sidebar.tsx:57–70`**: Community (`featureFlags.community`) and My stats. It is consumed twice in the same file — `:141` (`moreActive`) and `:250` (the render) — and **`grep -n "MORE_ITEMS" -r src` returns exactly those three lines**, so nothing else imports it.
- **`more-sheet.tsx` does NOT import it.** `src/components/layout/more-sheet.tsx:35–64` hand-rolls six `<Row>`s: My stats, Big Board, Rankings, Start or sit, Teams, Leagues — five of them flag-gated.
- **The split is deliberate and form-factor driven, and Chris confirmed it from production on his phone: with the current flags, More is effectively just "My stats" on both.** Desktop's sidebar shows the primaries directly (Big Board and Rankings live in `PRIMARY`, `sidebar.tsx:26–55`) with a small More; mobile's five bottom tabs push the overflow into the sheet, which is why Rankings sits in desktop's primary nav and mobile's More. **Same flags govern both. There is nothing to unify and this lane does not propose unifying them** — an earlier characterisation of this as drift was wrong and is withdrawn here rather than deleted.
- **The one real note is mechanical:** they are two independently-authored files, so **an edit to one silently misses the other with no type error and no test to catch it**. MP.6 edits **both** and adds the cheap pin (**F104**).

### 1.7 The release gate — the doctrine the lane must follow

- **`src/lib/feature-flags.ts` states its own rule** at `:27–31`: *"One flag per surface, deliberately — a single blunt 'launch' flag couldn't release them independently."* And at `:51–54`, about the retired `listsV2`: *"Do not reintroduce it — a flag with one branch is a lie about what ships."*
- **`enabled()` (`:13–17`)** is ON in development and OFF elsewhere unless `NEXT_PUBLIC_FLAG_*` is `"true"`; the docblock at `:9–11` requires each flag to read its own env var **literally** (`NEXT_PUBLIC_` vars are inlined at build time).
- **`featureFlags.leagues` currently gates everything mock-adjacent** — the Home league cards (`(shell)/page.tsx:27`), the sidebar league list, `HomeQuickActions`' first two chips, and `more-sheet.tsx:60`'s Leagues row. **Its docblock is stale** — *"Leagues, league teams, and the live draft — mock-data UI, no backend yet"* (`:20`) — which has not been true since M1. Filed as **F103**, not drive-by fixed.

### 1.8 Q23, AP.4 and B5 — the state this lane inherits

- **Q23 is open and BLOCKING, filed 2026-08-21 by the AP.4 Builder, which halted on it** (PR **#186**, branch `halt/AP.4-mock-bid-clock-Q23`). Its text: *"a mock's bid clock: does the 10-second mock number OVERRIDE a league that chose its own bid clock?"* **B5** is the blocker row.
- **AP.4's ruled half already ships — measured by that session and re-checked here.** `grep -rhoE "auction_bid_seconds'\)::int, *[0-9]+" supabase/migrations/*.sql | sort | uniq -c` → **9 occurrences, all `20`**; the same sweep for `auction_nomination_seconds` → **8, all `30`**; the schema bounds are `league-settings.ts:257–258`. **Zero lines change for the ruled half**, which is why the override was the whole of AP.4's remaining content.
- **The sentence Q23 collides with is printed LAW** — §8.8's pacing block, *What does NOT change*: ***"A mock is slow when the league's clocks are slow, and that is correct — mock fidelity means a commissioner who sets a 60-second bid clock finds out what a 60-second bid clock feels like."*** (`spec-redraft-leagues.md:575`.)
- **§8 of this document answers Q23 from Chris's rulings and closes it without AP.4.**

### 1.9 Numbers and chain heads (confirm again at task time — D161)

**Number note (D161's grep-together rule).** R, D, F, Q, E **and B** swept **together** across `main` @ `1d4620d` **and both open branches** (`gh pr list --state open` → **#180** `docs/DR2-draft-room-v2`, **#186** `halt/AP.4-mock-bid-clock-Q23`), over `PROGRESS-leagues.md`, `spec-redraft-leagues.md`, `ACTIVE-BUILD.md` and every `docs/specs/tasks-*.md`:

```
for ref in main pr180 pr186; do
  git archive $ref docs/specs/PROGRESS-leagues.md docs/specs/spec-redraft-leagues.md \
    docs/specs/ACTIVE-BUILD.md $(git ls-tree -r --name-only $ref docs/specs | grep '^docs/specs/tasks-') | tar -x -C $tmp
  for k in R D F Q E B; do grep -ohE "\b${k}[0-9]{1,3}\b" $tmp/docs/specs/*.md | sed "s/^${k}//" | sort -n -u | tail -4; done
done
```

| Counter | `main` | PR #180 | PR #186 | **This session takes** |
|---|---|---|---|---|
| R | 469 | 455 | 469 *(470/478 appear only inside D224's own correction-of-record and name no finding)* | *(none — Architect sessions file no findings; the next reviewer takes **R470**)* |
| D | 223 | 212 | **224** | **D225–D232** |
| F | 101 | 97 | 101 | **F102–F105** |
| Q | 22 | 21 | **23** | **Q24** *(one, §11)* — and **Q23 is answered here** (§8) |
| E | 77 | 74 | 77 | **E78–E80** |
| B | 5 | — | **5** | *(none — this PR **clears** B5; §8)* |

`D700` / `F97316` are the `#FFD700` / `#F97316` hexes in `spec-tier-view.md` and are excluded per **D180**. **F97 on `main` is a real row** as well as a hex; the ledger value is 97.

- **Spec version: this lane takes v2.16.** `main` is at **v2.15** (`spec-redraft-leagues.md:4`), PR #180 holds **v2.14**, and PR #186 does not touch the spec (`git diff main...pr186 --stat` → `ACTIVE-BUILD.md` + `PROGRESS-leagues.md` only). R312 is first-filed-keeps.
- **Migrations top at `093_uncontestable_instant_award.sql`; pgTAP tops at `041`.** MP expects **094+** and pgTAP **042+**, but **AP.5, AP.6, MS.2–MS.4 and SE all contend for the same band.** Confirm the real next-free with `ls supabase/migrations/ supabase/tests/` at task time and **do not trust a number written here** (D161/D166 — AP.1 and AP.3 both had their expected numbers move under them).

---

## 2. The premise correction

**What the spec assumes.** §8.8, since v2.3: a mock is *"solo practice under the league's real settings"*; *"any league member starts a mock from a pre-draft league (`setup`/`scheduled`)"*; the mock *"snapshots the league's real draft config … into a new `drafts` row"*; **v1 scope: "league-attached only (config, roster shape, and the player pool come from the league)."** D103(1) adds the seat requirement, and the code implements all of it faithfully (§1.1/§1.2). In this reading a mock is a **rehearsal of one specific league**, and everything else follows.

**What is true.** *"the main use case is just 'I want to practice drafting these players at these rounds or cost to see where my team ends up at the end'."* **Practice is the purpose. A league is optional context that makes practice better** — and when it is present, inheriting its settings is not a constraint to be worked around but *"a really awesome feature that current platforms fail to do effectively"* (ruling 4). Both statements are Chris's, and they are not in tension: **the league-attached mock keeps everything it has; a second kind of mock exists that never had a league.**

**Why the premise held so long, and it is not carelessness.** Chris's ruling 3 supplies the missing model. **Public leagues** need a fixed time and platform-dictated rules because you cannot organise strangers otherwise. **Friends leagues** — the ones this product is being built for — settle everything by group text and *"put them into the tool when they are all in the draft lobby together."* So the moment someone most wants to practise is **before any league on the platform has the settings in it**. The spec's premise assumed the league arrives first. In the real workflow it arrives last.

**The failure that told on it, and how it was misread.** Chris ran a practice draft in his own league and got *"practice draft failed, it says i need 11 more people"*. That message is `092:1234–1240`, and it is **the premise telling on itself**: a mock is a rehearsal of a real league, a real league needs a full seat map, therefore an under-filled league cannot rehearse. It was read, in-session, as a **UX gate** — a wording problem, or at worst a missing "add placeholder seats" shortcut. **It is neither.** The remedy the message names is closed to any non-commissioner (`063:404–407`, `063:428–433`), and even for a commissioner it asks the user to permanently deform their real league — inserting eleven `teams` and eleven `league_members` rows they will then have to remove — in order to run a throwaway practice. **A mock never refuses to start for want of humans. Empty seats become CPUs.**

**The failure mode is recorded here rather than tidied away** because it is the generalisable half: *an error message that is working exactly as designed is the most expensive kind of bug, because every instinct says to reword it.* Before rewording a refusal, ask what question the refusal is answering — and whether that is the question the user asked.

---

## 3. The rulings this lane exists to implement (Chris, 2026-08-21 — verbatim)

### 3.1 The premise that is wrong

> "also keep in mind a user may run a mock draft without even being 'in a league'. i'm not sure why you are so focused on making a mock draft connected to a specific leagues settings. … This is context so you can stop chasing down things that don't matter."

### 3.2 What a mock is FOR

> "when it comes to Mocks, the main use case is just 'I want to practice drafting these players at these rounds or cost to see where my team ends up at the end'. But they may not have an actual league they are in yet or their friends league probably hasn't decided on everything yet."

### 3.3 The two league types, which explain why

> "There are two main types of leagues, public leagues that random people sign up for that must have a set time because otherwise you can't reliably get strangers organized … (and typically the platform would actually dictate public league rules and scoring for consistency, 'Scout Scoring'). Okay, then the OTHER type of a league is a friends league where everyone has been doing this for years together. Those leagues typically use email and group texting to schedule the draft day and time. And they would talking off the FieldScout platform about all the league settings and details and then they will agree to those settings and put them into the tool when they are all in the draft lobby together."

### 3.4 The two entry points

> "I think there are two entry points to launching a mock draft. One being from the FieldScout.gg Home tab. This where you will launch a mock based on public league settings which will be standardized. The second would be from a League Home you are already, a button that sits next to the real launch draft lobby button that says 'Practice drafting here' and this one inheriting your league settings is actually a really awesome feature that current platforms fail to do effectively."

### 3.5 The report

> "it would also be great to have a Mock Draft Report that lives somewhere, that is basically a table of every player from the draft and their cost and what team they went to."

### 3.6 Where reports live

> "mocks should go to something on the User's profile, not at the league level. However, real drafts should have a place at the league level."

### 3.7 The navigation

> "under the More... section there can be a Mock Drafts tab that opens to show all past mock drafts and the user can click on each one to open it up and view the results."

### 3.8 Mocks are independent of league work

> "Mocks do not need to be connected to League work"

### 3.9 Design decisions (Architect; **D225–D232** — they enter PROGRESS §4 verbatim when this PR merges, the D126–D143 / D147–D156 / D166–D175 / D197–D203 / D216–D223 precedent)

#### D225 — Lane charter, numbering, and why MP is its own lane

1. **MP is a lane, not a set of MS tasks.** MS's charter is *authority inside the room* — who may drive a mock once it exists. MP's is *what a mock is and how you get to one, and what you take away*. They meet at exactly one place (the launch dialog — §7), and a lane that does both would have no coherent gate: MS's gate is §8.8 isolation, MP's is *"does this work with no league at all."*
2. **Task ids are `MP.1`–`MP.9`.** No `L.C`, `AP.`, `DR2.`, `SE.` or `MS.` id is reused, retired or renumbered. `MS.*` keeps every task it has (§7).
3. **Numbers taken: D225–D232, F102–F105, Q24, E78–E80, spec v2.16** (§1.9's sweep, over `main` and **both** open PRs).
4. **This PR folds the spec, and it has to.** §8.8's *"v1 scope: league-attached only"* is LAW and is the sentence Chris's ruling 1 contradicts. Cutting tasks that contradict LAW would oblige the first Builder to halt and file a spec question — a halt this session would have manufactured. **The fold is narrow (§10 item 1): the premise is amended, §8.8 is not rewritten, and its isolation guarantees are untouched.**
5. **This lane does NOT touch `ACTIVE-BUILD.md`** — F102, and the reason is F98's exactly: PR #180 rewrites that block and the loop-order list, and a second concurrent editor buys a conflict in the file the loop reads first. **A named actor discharges it** (F102), because F98 established that "discharged by the merge" names nobody and an unattended loop never surfaces an F-row as work.

#### D226 — The premise correction, and the failure mode worth keeping

1. §2 is the entry, in full, and it is the governing text of the lane. **A task that reads as "make the league-attachment nicer" has misread it.**
2. **The `create_mock_draft` seat refusal is the architecture answering correctly to the wrong question.** Recorded as a failure *mode*, not an incident: an error message working exactly as designed is the most expensive kind of bug, because every instinct says to reword it.
3. **What the fix is not.** It is not a better message, not an "add 11 placeholder seats" shortcut, and not a lowered `team_count`. All three leave the premise intact and all three deform the user's real league to run a throwaway.

#### D227 — A mock never refuses to start for want of humans: the seat primitive

1. **The constraint is real and is satisfied, not relaxed.** `draft_picks.team_id` is `NOT NULL` FK to `teams` (`065:160`) and the order needs every seat. So the missing seats must **exist as `teams` rows**.
2. **They must NOT be league rows.** `add_placeholder_seat` writes `teams` **and** `league_members` into the real league (`063:455` + `063:461`) — a §8.8 breach by construction, and it changes the D47/F28 capacity predicate every other seat RPC re-reads.
3. **The primitive: a mock seat is a `teams` row with `league_id IS NULL`, `owner_id = the launcher`, `list_id NULL`, recorded in `drafts.config.mock.cpu_seats` (an array of team ids), created inside `create_mock_draft`'s transaction and deleted with the mock.** `teams.league_id` is already nullable (`001:499`) and standalone teams already have their own RLS (`053:66–71`).
4. **The property that makes this the right shape, and it is the argument — isolation BY CONSTRUCTION, not by predicate.** A `league_id IS NULL` team is invisible to every league-scoped query in the codebase **without anyone adding an exclusion**. The alternative — a mock-seat flag on a league-scoped `teams` row — would require editing the capacity predicate at four-plus sites, and **a single missed site silently corrupts the real league's seat accounting**. Given §8.8's whole rule is "the real league is untouched", a mechanism whose safety depends on remembering to exclude it is the wrong mechanism.
5. **The human's seat is unchanged for a league-attached mock** — `092:1268–1292` still resolves the launcher's real franchise by default and still allows any active seat. Only the *empty slots* become CPU seats.
6. **Naming is a product surface and gets one rule, not a system.** CPU seats are named `CPU 1 … CPU N` unless the league's own placeholder naming already applies; no avatars, no personas, no generated team names. Chris ruled no explanatory copy for MS (D221(1)) and the same restraint applies — this lane adds no flavour it was not asked for.
7. **Deletion order matters and is a Builder trap.** `draft_picks` cascades from `drafts`, and `teams` has **no** cascade from `drafts`; so `delete_mock_draft` and `mock_draft_expire` must delete the draft **first** and the `cpu_seats` teams **second**, in the same transaction, or the FK refuses.

#### D228 — Where a league-less mock lives: the practice container, and the alternative that was measured and rejected

1. **The recommendation: a league-less mock is backed by a hidden, user-owned PRACTICE CONTAINER — a `leagues` row flagged `is_practice`, created on first use and reused thereafter, that the user never sees and no league surface ever enumerates.** The mock's settings live in that container, which is what makes *"the mock owns its settings"* literally true.
2. **The rejected alternative, priced rather than dismissed: make the league optional.** That means dropping `NOT NULL` on **four** columns (`drafts.league_id`, `draft_picks.league_id`, `draft_bids.league_id`, `league_chat.league_id` — §1.3), rewriting the **13** RLS policies keyed on `is_league_member`, adding a null-league arm to **50** in-body `is_league_member` call sites across **18** migration files, inventing a seat concept `draft_picks.team_id` can point at anyway, and building a parallel route family. **Every one of those 50 sites is an authorization gate**, so the failure mode of getting one wrong is not a bug, it is a hole. That is a milestone, not a lane.
3. **What the container costs, stated so it is not discovered later.** One additive `leagues` column (or one `settings` key) plus an exclusion predicate on `listMyLeagues` (`leagues-service.ts:437`) and on every future league-enumerating surface — filed as **F105**, because "every future surface" is exactly the shape of a forward obligation.
4. **§8.8's isolation rule is UNAFFECTED and its meaning is sharpened, not weakened.** §8.8 protects **the real league** a mock is attached to. A practice container is not a real league: nobody else is a member, it is never enumerated, it holds no rosters, no matchups and no invites, and it is destroyed with the practice it backs. **A standalone mock has no real league to isolate from, so its isolation obligation is vacuous — and MP.9 proves that vacuity rather than assuming it** (a whole-schema delta showing that a standalone mock's entire lifecycle touches nothing outside its own container and its own draft rows).
5. **The container is per USER and reused, not per mock.** §22.5's 3-active/5-per-hour caps already bound the mocks; minting a `leagues` row per launch would put an unbounded write behind a button. One container, whose `settings->'draft'` is rewritten at each standalone launch, is the cheaper and more auditable shape.
6. **Recorded as a recommendation Chris can overturn at this PR's review** — the D220 shape. It is a build-mechanics call with a product-visible edge (a hidden `leagues` row is a thing that exists in the database and did not before), and that edge is his to accept or refuse.

#### D229 — Standardized defaults ("Scout Scoring"), and what this lane does NOT build

1. **"Scout Scoring" does not exist in the repo.** `grep -rn "Scout Scoring" docs/ src/` → **no matches.** Chris coined it in ruling 3 as the thing *"the platform would actually dictate"* for public leagues.
2. **This lane builds the standardized MOCK preset and nothing else.** A Home-launched mock takes the schema's own defaults — the parsed `leagueSettingsSchema` block (`league-settings.ts:244/257/258`, `DEFAULT_ROSTER_SETTINGS` at `:164`) plus the existing default scoring template — under one named constant. **It does not build public leagues, a public-league lobby, matchmaking, or a new scoring catalog entry.** Those are ruling 3's *context*, not its ask.
3. **Where Q17's ten seconds actually lands (this is the reconciliation §8 turns on).** Q17 ruled *"a mock launches at 10s"* for the bid clock. A **league-launched** mock inherits its league's clock, because that is the feature. A **Home-launched** mock has no league, so **the standardized preset is where the 10-second bid clock belongs** — a default, not an override. Nothing is overridden and §8.8's fidelity sentence is untouched.
4. **The preset is one constant with one home, not a scattering of literals.** It is authored once in TypeScript and mirrored in the RPC through the existing pattern, with an equivalence test — the `templates.ts` TS↔DB precedent (spec v2.8.5). A second copy of the numbers is the failure §4.7 exists to prevent.
5. **The preset is adjustable, and that is a requirement rather than a nicety.** Chris's standing preference — assume every feature will change with feedback — plus his own words on clocks (*"every league is going to customize the clocks and probably change them multiple times"*). A launcher can change the clock in the room once **MS.3** lands; the preset is a starting point, not a policy.

#### D230 — The report: one flat table, two column sets — and why mock reports leave the league level

1. **Chris's ask is a table:** *"a table of every player from the draft and their cost and what team they went to."* Today the auction has a **list** (`AuctionFinalBoard`, `draft-recap.tsx:411–467`) and snake has a **grid** (`DraftBoardGrid`); neither is a table and snake has no flat cut at all (§1.4).
2. **TWO COLUMN SETS, NOT ONE TABLE WITH BLANKS.** An auction report is *player · position · team · **price** · **nomination #***. A snake report is *player · position · team · **round** · **pick #***. A single table carrying all five prints an empty `price` column on every snake row and an empty `round` column on every auction row — and an empty column is a claim that the value exists and is unknown, which is false in both directions. `recapBuysInOrder`'s own docblock already makes this argument about the board (*"an auction has no rounds × teams grid"*); this is the same argument one layer out.
3. **Compose, do not re-solve.** The auction column set is `recapBuysInOrder` (`draft-recap-ops.ts:157–159`) plus `recapTeamSpend` (`:135–152`) for the totals row. The snake column set needs one new pure derivation beside them, in the same file. **A second recap component is the LV.7 failure pattern** and is not the shape.
4. **The split Chris ruled (3.6) is a ROUTE split, not a data split.** Mock reports get a user-scoped home; **the league-level recap keeps real drafts and is otherwise unchanged** — same component, same route, same "Delete recap" affordance for any mock a user reaches by an old link. MP.8 owns the split and owes a **redirect**, not a deletion: the league recap route must keep answering `?draft=<mock_id>` and send it to the new home, because those URLs exist in the wild (the launcher's own `View recap` link, `mock-draft-launcher.tsx:329`).
5. **The report is the same for both kinds of mock.** A league-attached mock and a standalone mock produce the identical report at the identical route. That is the test that the lane got the abstraction right.

#### D231 — The lane's own release gate, and the precise distinction it draws

1. **`NEXT_PUBLIC_FLAG_MOCK_DRAFTS` → `featureFlags.mockDrafts`, and never `featureFlags.leagues`.** Chris: *"Mocks do not need to be connected to League work."* This is precisely the case `feature-flags.ts:27–31`'s own doctrine exists for.
2. **THIS IS A RELEASE STATEMENT, NOT A CODE-ISOLATION ONE, and the distinction is the whole decision.** A mock still runs on the **shared draft engine** — `drafts`, `draft_picks`, `draft_tick`, the room, the pgTAP suites, the RPC family. **That sharing is correct and stays.** What must not exist is a **dependency**: no MP task may be blocked on a league task, and **turning the `leagues` flag off must not turn practice off**.
3. **The pin is the assertion that keeps it true, and it is not optional.** With `leagues` **off** and `mockDrafts` **on**: the Home entry point renders and launches, the More… tab renders, `/app/mocks` lists, and a report opens. MP.9 owns the end-to-end version; MP.4 and MP.6 each carry their own half. **A lane that states an independence property without a test for it has stated an intention.**
4. **The flag gates UI SURFACES ONLY, never a `SECURITY DEFINER` RPC.** A `NEXT_PUBLIC_` flag is client-inlined; gating server authority on one would be a client-side gate on a server-authoritative surface, which §12 forbids outright. The RPCs stay reachable and stay authorized in-body.
5. **One consequence to accept honestly:** the League Home CTA (MP.7) sits on a league page, so **that one surface legitimately has a `leagues` dependency**. It degrades with the page it lives on, and nothing else in the lane does.

#### D232 — Q23 is answered by Chris's rulings, and AP.4 has nothing left in it

Full reasoning in §8. In brief: ruling 4 makes a league-launched mock's inheritance of its league's settings **the feature**, so §8.8's fidelity sentence is **correct and stays** and **there is no override**; a Home-launched mock has no league to inherit from, so Q17's ten seconds lives in the standardized preset (D229(3)) as a **default**. **Q23 resolves as "no override"; B5 clears; AP.4's ruled half already ships and its unruled half is now ruled away, so AP.4 closes with no code.** F85 is **not** discharged and its remaining term is **F92**.

---

## 4. Standing rules for every MP task

**`tasks-M3-auction.md` §4 rules 1–8 carry forward verbatim and in full force** — M1's four (grants doctrine D18→D23 · SECURITY DEFINER = in-body auth + `search_path=''` + REVOKE, §4.1 · the no-write-policy pgTAP pattern per role with RETURNING counts, §4.2 · the falsifiability floor incl. the ≥1 deliberate-break probe SHOWN failing and reverted, §4.3 · the migration checklist + typegen alias-block re-append, §4.4), M2's realtime doctrine (rule 5) and draft-row lock discipline (rule 6, incl. SQLSTATE conventions and held-lock < 50 ms per RPC family), and M3's solvency doctrine (rule 7) and bid-path discipline (rule 8). Builders cite all eight in the self-review note.

**Reproduced verbatim from `tasks-DR-draft-room-redesign.md` §4 rule 9**, because this lane's central claims — *"this works with no league"*, *"this touches nothing outside the mock"*, *"the flag is independent"* — are the species of claim that is easiest to assert from intent and hardest to notice when it is wrong:

> **A claim about the state of the world after your change must name the command or observation that establishes it — the falsifiability floor of tasks-M1/M2/M3 §4 rule 3, applied to prose — *no pin counts as a pin until it has been shown RED against the defect it claims to catch*. (This doc's own §4.3 is the design-system rule; the floor lives in the milestone docs, and DR tasks inherit it.)** This rule exists because of one measured pattern in DR.1's review (R339–R344, 2026-08-18): **every claim in that PR that had been MEASURED held up** — the `next build` route-manifest diff (136 URL values + 39 static/71 dynamic entries incl. every `namedRegex`, EMPTY), the same-cookie middleware differential in both directions, the F66 404 comparison against a `main` worktree, the shell-provider enumeration — several of them in more detail than they were written up with. **Every claim that failed was the same species: an assertion about the post-change world inferred from the INTENT of the change rather than observed.** "The rename replaced two identifiers so the file is still 1013 lines" (true of the rename, false of the commit — it was +22). "The other arms have buttons, so no state is a dead end" (four arms checked, two never enumerated — both had no exit at all). "The false docblock claim WAS corrected" (one of its two false sentences was). "`route-groups.test.ts` pins that" (pin written, path recalled — it is `src/lib/`, not `src/app/app/`). "Replayed with the identical cookie" (named in the helper, never delivered to `request.cookies`). Each was written in the *proved* register beside claims that genuinely were proved, and inherited their credibility; **each was one `grep`, one `wc -l`, or one DOM inventory away from being caught.** So, concretely: a sentence of the form *"X still lands"*, *"Y is not a dead end"*, *"Z was corrected"*, *"the pin covers it"* is **not shippable without the command or measurement beside it** — in the PR body, the docblock, or the PROGRESS entry. Prefer citing by **symbol** over line number where you can; a symbol survives the next edit. If you cannot cheaply establish it, write what you actually know ("not checked") — a hedge is free and a false disclosure costs the next Builder a day.

Seven more join them for this lane:

10. **§8.8's ZERO-SIDE-EFFECTS RULE IS THE GATE ON EVERY TASK, AND IT IS ANSWERED BY MEASUREMENT.** No MP task may create, delete or re-route a mock without, in the same PR, an isolation proof taken around the action: the **whole `leagues` row** and the **whole real `drafts` row** of any attached league, plus a **whole-row composite** (not a count) over every league-scoped table the write set or trigger graph can reach. *"It only writes `teams` with a NULL `league_id`"* is a reading, not a measurement. **For a standalone mock the obligation is not skipped — it is proven vacuous** (D228(4)): a whole-schema delta over all 56 `public` tables showing the entire lifecycle touches nothing outside the container and the mock's own rows.
11. **NO MOCK REFUSES TO START FOR WANT OF HUMANS.** This is the lane's product invariant and it is testable: for every seat count from 1 seated to `team_count` seated, and for zero leagues, a launch **succeeds**. A task that adds a new refusal to the launch path owes an explicit argument for why it is not this bug returning in a new coat.
12. **A MOCK SEAT IS NEVER A LEAGUE ROW.** No MP task inserts, updates or deletes `league_members`, or writes a `teams` row whose `league_id` is a real league. The CPU-seat primitive is D227(3) and there is exactly one implementation of it. **A second way to make a seat is a review finding.**
13. **THE FLAG GATES SURFACES, NOT SERVER AUTHORITY** (D231(4)). No `featureFlags.*` read appears in a route handler's authorization path, in a service-layer gate, or anywhere a SQL function's behaviour depends on it.
14. **REAL DRAFTS AND REAL LEAGUES DO NOT CHANGE. AT ALL.** No diff whose effect is visible on a real league's seat map, member list, capacity, recap, or on an `is_mock = FALSE` draft, belongs in this lane. `add_placeholder_seat`, `create_league`, `draft_start` and the league recap keep their shipped behaviour byte-for-byte, and their pgTAP pins pass untouched.
15. **THE DRAFT-ROOM LAYOUT IS PARKED AND THIS LANE DOES NOT MOVE IT.** DR2 (PR #180) is the layout rework and it is awaiting Chris's Figma. MP surfaces work **within** existing structures — the Home header's chip row, League Home's existing CTA row, the shipped recap components, the two existing More lists. If a Builder needs a new region, a resized zone or a new breakpoint, **stop and flag it**: that is a DR2 question, not an MP decision.
16. **NO NEW EXPLANATORY COPY, and this is inherited rather than re-decided.** Chris ruled *"no"* on teaching copy for the mock surface (MS §3 ruling 3 / D221(1)) and nothing in this lane reopens it. Labels say what a control does; a report's column header names its column. No tutorial, no onboarding hint, no first-run tip, no "what is a mock draft" explainer.
17. **EVERY NAV EDIT LANDS IN BOTH FILES.** `sidebar.tsx`'s `MORE_ITEMS` and `more-sheet.tsx`'s inline rows are independently authored (§1.6) and nothing couples them, so an edit to one silently misses the other. Both, in the same PR, plus the pin (**F104**). **This lane does not unify them** — the split is deliberate and form-factor driven.

---

## 5. Task list (one Builder session each; ≤ half a day)

Every task: branch from up-to-date `main`, **one task one PR, do not merge**. Migration and pgTAP numbers are **expected** — confirm the real next-free at task time (§1.9).

**Why nine tasks.** Three are server (**MP.1** the seat primitive, **MP.2** the standalone mock, **MP.9** the closing sweep); five are surfaces (**MP.3** the gate + the practice home, **MP.4** Home, **MP.5** the report, **MP.6** the nav, **MP.7** League Home); one is the route split (**MP.8**). **MP.1 is first and is not negotiable** — it is a live bug Chris hit in production use, it blocks nothing else conceptually, and it builds the primitive MP.2 needs.

---

### MP.1 — A mock never refuses to start for want of humans *(migration ~094)*

> Read spec **v2.16 §8.8** (the whole section, including the amended Launch bullet), this doc **§1.1, §1.3, §2, D227**; `tasks-M3` §4 rules 1–4; `CLAUDE.md`'s migration discipline and its "Never let *nothing happened* mean *it worked*". **Lane opener. This is the bug Chris hit: *"practice draft failed, it says i need 11 more people"*.**

1. **`CREATE OR REPLACE create_mock_draft` against the file text of its HEAD (`092:1128–1422`)** — not against `pg_get_functiondef`, not against 089 or 071 (D137/CLAUDE.md). Two hunks: the DECLARE, and the seat block.
2. **Replace the refusal at `092:1232–1240` with seat synthesis.** Count the league's active franchises exactly as today (`status <> 'retired'` — the D47/F28 predicate, byte-identical); for every missing slot, insert a **mock seat**: a `teams` row with `league_id = NULL`, `owner_id = auth.uid()`, `list_id = NULL`, `name = 'CPU N'` (D227(6)). Collect the new ids into `config.mock.cpu_seats` (a JSONB array of text ids, the R117 TEXT-comparison rule).
3. **The seat map handed to `draft_resolve_order_internal` is the real franchises plus the mock seats**, in that order, so a league that IS fully seated produces a byte-identical order to today. **Pin that**: same league, same mock id ⇒ identical `draft_order` before and after this migration.
4. **A seat count of ZERO is still a refusal, and it is a different one.** A league whose `team_count` is 0, or with no active franchise at all, has nothing to practise against a slot of; keep a friendly P0001 that names its own reason. Every other count — 1 seated through `team_count` seated — **succeeds**.
5. **`delete_mock_draft` (`071:469–515`) and `mock_draft_expire` (`071:524–610`) both gain the cleanup**, in the correct order (D227(7)): delete the draft first (picks/bids/queues cascade), then `DELETE FROM public.teams WHERE id = ANY(<cpu_seats>) AND league_id IS NULL`. **The `league_id IS NULL` predicate is a safety belt, not decoration** — it makes a malformed `cpu_seats` array incapable of deleting a real franchise.
6. **pgTAP (~042), and the §4 rule 10 isolation composite is the centrepiece.** A 12-team league with **1** seat filled launches a mock; the mock runs; and around the whole lifecycle (launch → some picks → delete) the real league's **whole `leagues` row**, its **`teams` rows**, its **`league_members` rows** and its **whole real `drafts` row** are byte-identical (`to_jsonb(...)::text` / `EXCEPT ALL`, never counts — a count cannot see an in-place UPDATE). Plus the whole-schema delta over all 56 `public` tables.
7. **The seat-count sweep is the product invariant (§4 rule 11):** launch succeeds at 1, 2, … `team_count` seated. Assert the fixture is non-empty before asserting anything about it (**F94** — the local player pool is empty after a `db reset`).
8. **≥1 deliberate-break probe SHOWN failing and reverted** (§4.3). The recommended probe is the one that matters: make the cleanup delete `teams` **without** the `league_id IS NULL` guard and show the isolation composite going red on the real league's franchises.
9. **DoD:** fresh `npx supabase db reset` over the full chain, `npm run test:db`, `npm run test`, `npm run test:gate`, `npm run type-check` — all shown, none claimed.

---

### MP.2 — A mock with no league at all *(migration ~095 + the standardized preset + the API)*

> Read this doc **§1.2, §1.3, D228, D229**; spec **v2.16 §8.8**'s amended v1-scope bullet; `tasks-M3` §4 rules 1–4. **Depends on MP.1** — it reuses the seat primitive for all N seats.

1. **The practice container.** A `leagues` row the user never sees: flagged additively (`leagues.is_practice BOOLEAN NOT NULL DEFAULT FALSE`, or one `settings` key — the Builder chooses and states why), owner = the user, **one per user, created on first standalone launch and reused**. It holds **no** teams, no invites, no rosters, no matchups. `league_members` carries exactly one row so `is_league_member` answers for the launcher.
2. **The exclusion, and it is not optional.** `listMyLeagues` (`leagues-service.ts:437`) excludes practice containers; so does every league-enumerating surface the Builder can find (`grep -rn "from('leagues')" src/lib src/app/api` → **114 sites**, most of them tests — enumerate the non-test ones and say which needed the predicate). **Pin it:** a user with a practice container sees the same `/api/leagues` payload as a user without one. **F105** carries the standing obligation for surfaces that do not exist yet.
3. **The standardized preset (D229).** One named constant in TypeScript, mirrored into the launch RPC through the existing pattern, with a TS↔DB equivalence test (the `templates.ts` precedent). It is the schema's own defaults (`league-settings.ts:244/257/258`, `DEFAULT_ROSTER_SETTINGS` at `:164`) plus the default scoring template — **and the 10-second auction bid clock ruled by Q17 lands HERE, as a default of the standardized preset and nowhere else** (D229(3)/§8). **It does not build public leagues.**
4. **The launch RPC.** `create_practice_mock(p_draft_type, p_team_count, p_cpu_speed, p_slot, p_action_id)` — or `create_mock_draft` gaining a nullable `p_league_id` arm; **the Builder picks one and states the reason**, with the constraint that there is **one** seat-synthesis implementation and **one** order resolver (`draft_resolve_order_internal`, whose HEAD is `066`; the mock's call site is `092:1304–1325`, seeded by the mock's own id). `SECURITY DEFINER`, `search_path=''`, in-body auth, REVOKE. §22.5's caps apply unchanged and are counted the same way.
5. **Cleanup is part of this task, not a follow-up.** `delete_mock_draft` and `mock_draft_expire` remove the mock, its CPU seats, its chat rows **and** — when the user's last practice mock goes — leave the container in a state that is either reused or removed. **A task that creates rows and does not delete them is not done.**
6. **pgTAP (~043).** A user in **zero leagues** launches a standalone mock, drafts, completes, and deletes it. **The §4 rule 10 proof for this task is the vacuity proof** (D228(4)): a whole-schema delta over all 56 `public` tables across the whole lifecycle shows changes confined to the container, the mock's `drafts`/`draft_picks`/`draft_bids`/`draft_queues`/`league_chat` rows, and the `cpu_seats` teams — **nothing else, in either direction**. Plus: no notification row, no `league_rosters` row, no `transactions` row, and no broadcast on any `league:<id>` topic but the container's own.
7. **≥1 deliberate-break probe SHOWN failing and reverted** — recommended: drop the `listMyLeagues` exclusion and show the container appearing in a user's league list.
8. **Typegen:** regenerating `src/types/database.ts` clobbers the hand-written alias block at the bottom — preserve and re-append it, and verify the diff is additive-only (§4.4).

---

### MP.3 — The lane's own release gate, and the practice home

> Read **D231** and `src/lib/feature-flags.ts` in full — its `:27–31` one-flag-per-surface doctrine and its `:51–54` warning about single-branch flags. **This task creates the surface MP.5 and MP.6 both hang off.**

1. **`NEXT_PUBLIC_FLAG_MOCK_DRAFTS` → `featureFlags.mockDrafts`**, added literally (never dynamically — `feature-flags.ts:9–11`), with a docblock that states the release/isolation distinction in D231(2)'s words. **Add it to `.env.example`.**
2. **`/app/mocks` — the practice home.** A user-scoped route listing **every** mock the user launched, league-attached and standalone alike, active and completed. Each row opens its report (MP.5). Gated on `mockDrafts` **only**.
3. **The user-scoped read is new work.** `useMockDrafts` is keyed on a league (`use-mock-drafts.ts:42–48`) and `listMockDrafts` takes a `leagueId` (`draft-service.ts:1411`). Add the user-scoped sibling — `GET /api/mocks` — reusing the same column selection and the same launcher-scoped server-side filter. **Do not widen the league route to mean "all"**; two questions, two endpoints.
4. **`MockRow` is reused, not reimplemented** (`mock-draft-launcher.tsx:284`, already mounted twice — the launcher and `MockPracticeCard` at `league-home-states.tsx:181/184`). A third mount is the intended shape; a second row component is the LV.7 failure pattern. **Its league-scoped links need a league-optional arm** — `View recap` at `:329` and the resume link at `:333` both interpolate `leagueId`.
5. **The exits.** A standalone mock's room and report must not offer *"Back to league"* pointing at a container the user never joined (`draft-recap.tsx:437`, `mock-draft-launcher.tsx:103/119`). Standalone exits go to `/app/mocks`. `room-exits.test.ts` and `room-entry.test.ts` pin the current inventory by count — **re-point them, do not delete them.**
6. **The flag-off half of D231(3):** a test that `/app/mocks` renders and lists with `featureFlags.leagues` **off**.

---

### MP.4 — Launch a mock from Home *(the first of Chris's two entry points)*

> Read **§3.4**, **D229**, **D231**; this doc **§1.5**. **Depends on MP.2** (there is nothing to launch without it) **and MP.3** (the flag and the destination).

1. **The affordance sits in the existing Home structure** (§4 rule 15) — the natural place is `HomeQuickActions`' chip row (`home-quick-actions.tsx:47–90`), which already renders one un-gated chip (List) beside two `leagues`-gated ones. **A new hub card is a layout decision and belongs to DR2/the Figma, not here.**
2. **It launches a mock on the standardized preset** — MP.2's constant, no league involved. The dialog answers the minimum set of questions and no more: draft type, team count, and (once **MS.8** lands, or ahead of it) the starting slot. **The launcher's seat is a CPU-seat franchise that MP.1's primitive mints; there is no "choose a seat" question because there are no other franchises to choose between.**
3. **ONE launch dialog, not two.** `MockDraftLauncher` (`mock-draft-launcher.tsx:57`) already owns the launch form — the seat `Select` at `:140–155`, the CPU-speed `Segment` at `:160`, the submit at `:187`. **Compose it with a league-optional arm**; do not fork it. This is the single seam where MP and MS meet (§7), and a second dialog would make MS.8's slot picker a two-place change.
4. **The `leagues`-off pin (D231(3)):** with `featureFlags.leagues` **off** and `mockDrafts` **on**, the chip renders, the dialog opens, the launch succeeds, and the room loads. **This is the assertion that makes ruling 3.8 true rather than intended.**
5. **`HomeQuickActions`' two stub chips are NOT this task's business** — they toast, they are `leagues`-gated, and touching them is scope creep. Note them; do not fix them.

---

### MP.5 — The Mock Draft Report *(one flat table, two column sets)*

> Read **§3.5**, **D230**; this doc **§1.4**. **Depends on MP.3** for its home.

1. **`/app/mocks/[mockId]`** renders the report for any mock the viewer launched (RLS does the authorization; an unknown, foreign or unfinished id lands on one honest empty state — the existing recap page's no-leak posture, `recap/page.tsx:15–21`).
2. **A real table with column headers.** **Auction:** player · position · team · **price** · **nomination #**, plus a per-team spend summary from `recapTeamSpend` (`draft-recap-ops.ts:135–152`). **Snake/linear:** player · position · team · **round** · **pick #**. **Never one table with blank columns** (D230(2)).
3. **Compose the shipped derivations.** `recapBuysInOrder` (`draft-recap-ops.ts:157–159`) is the auction row set; add the snake sibling **in the same ops file**, pure, with colocated tests. `recapRostersFromPicks` and `recapTeamSpend` stay the single source for grouping and totals. **No second recap component tree.**
4. **Wide content scrolls inside its own container** — CLAUDE.md's responsive rule, the treatment `AuctionFinalBoard` already uses (`draft-recap.tsx:432–437`: `overflow-y-auto`, `role="region"`, `tabIndex={0}`, an `aria-label`). Sort defaults to the draft's natural order (nomination sequence / pick number).
5. **Elevation:** nothing in normal page flow is elevated at rest (CLAUDE.md). A table is not an overlay.
6. **The delete affordance travels with the report** — `delete_mock_draft` is launcher-keyed at `071:500–504`; the UI must not offer it more widely (`recapVariant`'s `canDelete`, `draft-recap-ops.ts:50`).
7. **A league-attached mock and a standalone mock produce the identical report at the identical route** (D230(5)). Pin both.

---

### MP.6 — Mock Drafts under More… *(both lists, and the pin)*

> Read **§3.7**, this doc **§1.6**, **§4 rule 17**. **Depends on MP.3.**

1. **Add a `Mock Drafts` entry pointing at `/app/mocks`, gated on `featureFlags.mockDrafts`, to BOTH:** `MORE_ITEMS` (`sidebar.tsx:57–70`) and `more-sheet.tsx`'s inline rows (`:35–64`). **Same label, same icon, same flag.**
2. **Do not unify the two lists.** The split is deliberate and form-factor driven (§1.6) and Chris confirmed the production behaviour. **A PR that refactors them into one source has left this lane.**
3. **The pin (F104), and it must be cheap or it will not survive.** One test asserting the two files agree about the entries that are common to both — the shape `elevation-rule.test.ts` and `draft-command-bar.test.ts:151–153` already use in this codebase (read the source text, assert against it). **Show it RED** by adding the row to one file only.
4. **The `leagues`-off pin (D231(3)):** with `leagues` off, More still shows My stats and Mock Drafts.

---

### MP.7 — League Home: "Practice drafting here" *(the one surface with a legitimate leagues dependency)*

> Read **§3.4**, **D231(5)**, this doc **§1.5**. **Depends on MP.3** for the flag only.

1. **The button already exists and is already in the right place — verify before you build.** `PracticeCta` renders beside `Enter draft lobby` at `league-home-states.tsx:463–468`, and again in `SetupHero` at `:326` and `draft-lobby.tsx:251`. **This task changes its label to Chris's words and confirms the placement; it does not add a fourth CTA.**
2. **The label is `Practice drafting here`** (§3.4). One component, three mounts, one change (`league-home-states.tsx:537–553`). Check `draft-lobby-ops.test.ts:234–239`, which pins the CTA's presence by source text.
3. **Delete the dead disabled branch** (`:539–545`) — `MOCK_LAUNCHER_READY` has been `true` since L.B3.5 (`mock-launcher-entry.ts:10`), so that arm is unreachable. **This is the one in-file tidy this lane authorises**, because the task is already rewriting the component.
4. **Add the mock flag to the CTA** — it renders when `mockDrafts` is on. It also, unavoidably, disappears when `leagues` is off, because the page it lives on does. **State that in the PR: it is D231(5)'s accepted consequence, not a leak.**
5. **The league-launched mock keeps inheriting the league's settings, exactly as today** (`092:1219`). **This is the feature (ruling 4) and §8 is why the fidelity sentence stays.** Nothing in this task changes what is snapshotted.

---

### MP.8 — The split: mock reports leave the league level, real recaps stay

> Read **§3.6**, **D230(4)**. **Depends on MP.5.**

1. **`/app/leagues/[leagueId]/draft/recap` keeps real drafts and is otherwise unchanged.** Same component, same behaviour, same pins.
2. **`?draft=<mock_id>` REDIRECTS to `/app/mocks/<id>`** — a redirect, never a 404 and never a deletion. Those URLs exist: the launcher's own `View recap` link builds one (`mock-draft-launcher.tsx:329`) and `MockPracticeCard` renders those rows on League Home (`league-home-states.tsx:181/184`).
3. **Every in-app link to a mock recap moves in the same PR.** `grep -rn "draft/recap" src` and enumerate; a link left behind is a redirect hop the user pays for forever.
4. **`MockPracticeCard` on League Home (`league-home-states.tsx:165–192`) stays** — practising *this* league is a league-page thing. Its rows link to the new report home.
5. **Pin the redirect and pin the real recap's unchanged behaviour** (§4 rule 14).

---

### MP.9 — The closing sweep: the flag is independent and a practice mock leaves nothing behind

> Read **D228(4)**, **D231(2)–(3)**, **§4 rules 10–13**. **Runs last by definition** — a verification pass over an unfinished lane verifies nothing (the MS.6/DR.8 precedent).

1. **The independence end-to-end (D231(3)):** with `NEXT_PUBLIC_FLAG_LEAGUES=false` and `NEXT_PUBLIC_FLAG_MOCK_DRAFTS=true`, a user in zero leagues reaches Home → launches → drafts → completes → opens the report → finds it under More… → deletes it. **One run, shown.**
2. **The vacuity proof, as a permanent assertion rather than a session's observation:** the whole-schema delta over all 56 `public` tables around a standalone mock's entire lifecycle.
3. **The seat-count sweep as a suite** (§4 rule 11): 1 … `team_count` seated, plus zero leagues.
4. **A grep-level pin for §4 rule 13:** no `featureFlags.` read in a route handler's authorization path or a service-layer gate.
5. **State whether the §8.8 harness MS.6 builds should absorb (2)** — the two are the same question asked of two different worlds, and one harness is better than two. **If MS.6 has not landed, say so and leave the seam named** rather than building a second harness speculatively.
6. **Name MP's suites for `L.C6.1`** — the M3 gate composes lane suites by name (F84 for AP, F90 for DR2). One line at merge; not a fourth F-row.

---

## 6. Explicitly out of scope — and this list is strict

- **The draft-room layout rework is PARKED pending Chris's Figma.** That is **DR2**, PR #180. MP works inside existing structures (§4 rule 15). A Builder who needs a new region, a resized zone or a new breakpoint **stops and flags it**.
- **The commissioner PICK SWAP is F101, real-league scope, and is NOT built here.** Chris named it during the MS session (*"oh you like the 7th pick i like the 3rd pick. and then the commish needs to be able to swap them"*); today's editor is a move-and-shift (`draft-order-editor.tsx:124` → `reorderIds`, `my-queue-ops.ts:42–54`) that displaces four bystanders to execute a two-party agreement. It is real, it is filed, and it is not MP's. **A task that begins "while we're in the order editor…" has left this lane.**
- **NO TRADE SYSTEM.** Not for picks, not for players, not in a mock and not in a real league. No proposals, no approvals, no vetoes, no notifications. Chris was explicit that the agreement happens off-platform.
- **Public leagues.** Ruling 3 explains *why* a standardized preset exists; it does not ask for public leagues, a public lobby, matchmaking, or a "Scout Scoring" catalog entry. MP builds the **standardized mock preset** and stops (D229(2)).
- **Multi-human mock rooms** — §8.8's v1.1 line, and untouched. Everything in this lane is about a solo practice; a second human in the room reopens D103's original authority question.
- **Broadening who may act on a real league.** Nothing here touches `is_league_commish`, co-commissioner scope, seat ownership, `canUseCommishPanel`, or `add_placeholder_seat`'s commissioner gate.
- **Any change to the §8.7 commissioner surface.** That is **MS**, merged and separate (§7). MP does not enable, disable, re-route or re-word a single commissioner control.
- **`commissioner_actions` audit rows.** F32/F40 stand: the table does not exist until M6.
- **Unifying the two More lists** (§1.6/§4 rule 17) — deliberate, confirmed in production, nothing to fix.
- **Defensive machinery for humans changing their minds or dropping connection** — the standing ruling (*"in drafts that's known as a 'personal problem'"*). No confirms beyond the hard-confirm class already specced, no undo-the-undo, no reconnect nanny.

---

## 7. The MS relationship — what changes meaning, and what does not

**MS keeps its narrower job and every one of its eight tasks.** MS owns **authority inside the room**: which §8.7 commissioner controls a launcher may reach once a mock exists, and what they do. **MP owns getting there and what you take away**: how a mock comes into being, with or without a league, and where its result lives. **They meet at exactly one place — the launch dialog** (MP.4 item 3 / MS.8).

**Nothing below silently contradicts a merged breakdown.** Where a merged MS statement acquires a new edge case, it is named and the resolution is stated.

| MS task | Does its meaning change? | What MP requires of it, or of a reader |
|---|---|---|
| **MS.1** — the audit | **No change to the method; one clarification.** MS.1's §8.8 gate is *"writes nothing to the real league"*. For a standalone mock **there is no real league**, so the question is vacuous there. **The audit fixture must stay the league-attached kind** — it is the strictly harder case, and D218(4)'s rule (drive every control through the surface a user reaches it by, with a real draft alive in the same league) is unaffected and still correct. |
| **MS.2** — the launcher gate | **No change.** The gate is keyed on `config.mock.launched_by` and on nothing else (D217(3)) — league-agnostic already. Its load-bearing fix (the `is_league_commish`-before-mock-refusal ordering, D217(5)) is about league-attached mocks and stays exactly as written. One vacuity: *"a commissioner who did not launch the mock gets nothing"* has no subject in a standalone mock. **Not a change; a world where the rule has nothing to bite on.** |
| **MS.3** — the D141 clock carve-out | **No change, and it becomes MORE load-bearing.** §8 makes MS.3 the *only* remedy for a launcher who wants a faster clock than their league chose — Q23 resolves with no override, so the in-room edit is the answer. **MS.3 should be treated as the higher-value half of the MS lane after this PR, not the lower.** |
| **MS.4** — `draft_reset` in a mock | **The decision is unchanged and must be taken against the LEAGUE-ATTACHED case.** For a standalone mock the `leagues` row a reset would write is the practice container, which is not a real league — so the breach is absent there. **That must not soften the decision**: there is one body, and the binding case is the attached one. D220's `live`-at-pick-1 constraint is untouched. |
| **MS.5** — surfacing the tools | **No change to what it renders; one exit it must not assume.** MS.5 works inside the command bar and the shipped panel. **MP.3 item 5 owns the standalone room's exits** — MS.5 must not add a *"Back to league"* affordance, and if a Builder finds one in its path, it belongs to MP.3. |
| **MS.6** — the §8.8 harness | **One seam, and MP.9 item 5 names it.** MS.6's composite is over *the real league*. MP.9's is a whole-schema vacuity proof for a world with no real league. **Recommendation: MS.6 keeps its single mode; MP.9 either extends that harness or states plainly why a second is warranted.** Whichever lands second owns the reconciliation. |
| **MS.7** — the order edit targets the mock | **No change, and still required.** The mis-target (`patchDraftOrder` resolving `.eq('is_mock', false)`, `draft-service.ts:198–204`) is a league-attached bug: a standalone mock has no real draft to hit. **MS.7 stays exactly as scoped**, and its hard ordering constraint with MS.5 is unaffected. |
| **MS.8** — choose your slot at launch | **This one changes meaning the most, and it is the seam.** D223's slot picker writes the mock's own order with *"the other franchises shuffled around you"* — for a standalone mock the other franchises are **MP.1's CPU seats**. **MS.8 is neither re-scoped nor dropped**; the requirement is that **there is ONE launch dialog** (MP.4 item 3). If MS.8 lands first, MP.4 composes it with a league-optional arm; if MP.4 lands first, MS.8 extends the one dialog. **Whichever is second must not fork it** — a second dialog turns every future launch question into a two-place change. |

**Should any MS task be re-scoped or dropped? No — all eight stand.** Two recommendations follow instead, and both are recommendations rather than changes because `ACTIVE-BUILD.md` is contended with PR #180 (**F102**, F98's reason):

1. **MS's ordering in `ACTIVE-BUILD.md` step 1b should change.** MS currently sits **behind AP** — a mock lane sequenced behind an auction-engine lane. **That is exactly the coupling Chris's ruling 3.8 rules out** (*"Mocks do not need to be connected to League work"*). **Recommendation: MS and MP become a mock track that is a peer of `AP.*`, `DR2.*` and `SE.*` and blocks none of them**, with `MP.1` taken first in the whole track because it is a live bug. This is a sequencing recommendation with a product ruling behind it, and it is Chris's call at this PR.
2. **MS should NOT move wholesale behind `featureFlags.mockDrafts`, and the reason is D231(4).** MS.1–MS.4 and MS.6–MS.8 are SQL and service-layer work — a `NEXT_PUBLIC_` flag on a `SECURITY DEFINER` RPC would be a client-side gate on server authority, which §12 forbids. **Only MS.5 is a user-visible surface, and MS.5's surfacing should ride `mockDrafts`** rather than anything league-shaped. That is the whole of the inheritance, and it is one line in MS.5's task rather than a re-scope of the lane.

---

## 8. Q23, answered — and what becomes of AP.4

**Q23 as filed:** *"a mock's bid clock: does the 10-second mock number OVERRIDE a league that chose its own bid clock?"* Filed 2026-08-21 by the AP.4 Builder, which halted on it (**B5**, PR #186). **It is BLOCKING and it is AP.4's entire remaining content** — Q17's three ruled numbers are already the shipped values (§1.8).

**The answer, and it comes from Chris's own rulings rather than from this session's judgement.**

1. **Ruling 3.4 makes inheritance the feature.** *"the second would be from a League Home you are already, a button that sits next to the real launch draft lobby button that says 'Practice drafting here' and **this one inheriting your league settings is actually a really awesome feature that current platforms fail to do effectively**."* A league-launched mock inherits its league's settings **because that is the point of launching it from the league**. An override would take the one thing he just called the differentiator and switch it off for the clock that dominates an auction's running time.
2. **Therefore §8.8's fidelity sentence is CORRECT AND STAYS, and there is NO OVERRIDE.** *"A mock is slow when the league's clocks are slow, and that is correct — mock fidelity means a commissioner who sets a 60-second bid clock finds out what a 60-second bid clock feels like."* (`spec:575`.) **No erratum. No narrowing. Nothing weakened.** Q23's option (a) is declined, and options (c) and (f) stay rejected for the reasons the question already gave.
3. **A Home-launched mock has no league to inherit from, so the question does not arise there — and that is where Q17's ten seconds belongs.** The standardized preset (D229) is a **default**, filling a value nothing else supplies. Q17 said *"a mock launches at 10s"*; that sentence is now true of every mock that has no league telling it otherwise, and it overrides nobody. **Q17 and §8.8 are both satisfied, unamended.** This is not a compromise between them — it is the reading under which neither was ever wrong.
4. **The remedy for a launcher who wants a faster clock than their league chose is to change it IN THE ROOM — `MS.3`.** That is the D141 carve-out Chris already ruled (*"the user running the mock should be able to make it as fast as possible IMO and pause it if they need to do something"*), folded as spec §8.7 v2.15 and scheduled as MS.3. **The launcher is not stuck with 60 seconds; they are one control away from 10, and they choose it rather than having it chosen for them.** Q23's evidence item 4 said there was *"no remedy in the room today"* — correct, and MS.3 is that remedy, already law and already scoped.
5. **Q23 therefore RESOLVES AS "NO OVERRIDE", and it resolves without AP.4 building anything.**

**What becomes of AP.4.** Measured by the halted session and re-checked in §1.8: the league bid-clock default is already 20 (**9 occurrences, all 20**), the nomination clock is already 30 (**8, all 30**), the 10-second floor and the ranges already match §7.3.8. **Zero lines change for Q17's ruled half, and Q23's answer is that its unruled half is not built at all.** So **AP.4 closes with no code** — its checklist row is marked closed-as-satisfied with a pointer to this section, and its remaining content moves to **MP.2 item 3** (the ten seconds, as a standardized-preset default) and **MS.3** (the in-room remedy). **B5 clears.** PR #186 is a documentation-only halt record; whoever merges this PR resolves it as answered rather than leaving a blocker standing on a question that is closed.

**What this does NOT do, said plainly because the temptation is to claim it.** **F85 — §8.8's under-45-minute mock-auction bar — is NOT discharged.** The halted session's measurement stands and is the honest arithmetic: at a 10-second bid clock the default shape ran **51m55s**, still **6m55s over** the bar, and its remaining terms are the AFK launcher's own nomination clock and **13m17s of CPU-nomination sweep latency, which is F92**. **A standardized 10-second preset is necessary and not sufficient**, exactly as measured. And for a league that chose 45 or 60 seconds, the bar is not met at all — **that is the correct outcome, because the bar is about the product's defaults, not about overriding a commissioner's choice.** F85's own text already says one of its two terms must change; after this PR that term is **F92**.

---

## 9. Sequencing

```
MP.1 (~094: empty seats become CPUs — the live bug, the seat primitive)   ← lane opener
  └─→ MP.2 (~095: the standalone mock — container, preset, RPC, cleanup)
        ├─→ MP.4 (Home entry point)            ← needs MP.3's flag + destination
        │
MP.3 (the mockDrafts flag + /app/mocks + the user-scoped list)  ← independent of MP.1/MP.2*
  ├─→ MP.5 (the report: one table, two column sets)
  │     └─→ MP.8 (the route split + the redirect)
  ├─→ MP.6 (Mock Drafts under More… — BOTH lists + the pin)
  └─→ MP.7 (League Home: "Practice drafting here")
                                                MP.9 (closing sweep)  ← last, by definition
```

- **`MP.1` is first and is not negotiable.** It is a live bug Chris hit in his own app, it needs nothing from the rest of the lane, and it builds the seat primitive `MP.2` consumes.
- ***`MP.3` may start before `MP.2`*** — listing only league-attached mocks is a legal, honest intermediate state. Taking it early unblocks four surfaces at once; taking it late means one pass over the practice home instead of several.
- **The migration lane is serialized** (delivery plan §2.2): `MP.1` → `MP.2`, each `CREATE OR REPLACE` authored against the chain HEAD's **file text** (D137/CLAUDE.md). `MP.3`–`MP.8` carry no migration; `MP.9` adds pgTAP only.
- **`MP.5`, `MP.6` and `MP.7` are independent of one another** and may take any order after `MP.3`.
- **`MP.9` runs last by definition** — a verification pass over an unfinished lane verifies nothing (the MS.6 / DR.8 precedent).
- **There is exactly one cross-lane ordering seam and it is the launch dialog:** `MP.4` and **`MS.8`** both touch `MockDraftLauncher`'s form. **Neither forks it.** Whichever lands second composes.

**Where MP sits relative to the other lanes:**

- **MP is a peer of `AP.*`, `DR2.*`, `SE.*` and `MS.*` and blocks none of them.** It touches no auction pacing surface, no room layout, and no scoring editor. **Recommendation (§7): MS and MP form one mock track that is a peer of the league lanes** — Chris's ruling 3.8 read as a sequencing statement. **Filed as F102 rather than written into `ACTIVE-BUILD.md` here**, because PR #180 rewrites that block.
- **Shared surfaces:** `PROGRESS-leagues.md` (append-collisions resolved at merge — the established pattern), the migration/pgTAP number band (§1.9 — confirm next-free at task time), `MockDraftLauncher` with MS.8, and `draft-recap*` with nothing currently in flight.
- **MP must land before `L.C6.1`.** The M3 gate composes lane suites by name (F84 for AP, F90 for DR2); MP's pgTAP files and its vacuity proof join that list. **Not filed as a separate F-row** — F84's text is the general obligation and MP.9 item 6 carries the enumeration.

---

## 10. Open items (not tasks — recorded so they are findable)

1. **The spec fold in this PR is deliberately narrow, and here is exactly what it does.** §8.8's **Launch** bullet is amended (the premise: practice is the purpose; two entry points; unfilled seats become CPUs); §8.8's **v1 scope** bullet is amended (a standalone practice mock is v1 — multi-human mock rooms stay v1.1); a new **v2.16 block** states the rulings, the report and the report's home, and re-states the zero-side-effects rule over both kinds of mock; §19.2 gains **E78–E80**. **§8.8's isolation guarantees are NOT weakened, and its pacing block — including the fidelity sentence — is NOT touched** (§8). **§8.7 is not touched at all** (that is MS's fold, merged at v2.15). **§16 is deliberately NOT edited** — PR #180 rewrites §16.4 substantially, and MS set the precedent of keeping route naming inside the §8.8 block rather than buying a conflict for no content. If a Builder finds a §16 sentence is genuinely needed, it rides that task's own PR as an erratum.
2. **Merge conflicts with PR #180 are expected and all are trivial** — the spec's `**Version:**` header line, the top of the changelog, and the tail of §19.2's edge-case table (DR2 appends E71–E74 where this PR appends E78–E80). Resolve as "keep both, in order". **No conflict is expected in §8.8** — DR2's nearest spec hunk was measured during the MS session at `@@ -570,14 @@`, which is §8.9; **re-measure at merge rather than trusting that number.** Conflicts with PR #186 are limited to `PROGRESS-leagues.md` §3/§5 and are append-shaped.
3. **`ACTIVE-BUILD.md` is untouched by this PR and that is deliberate** — **F102**, the F98 precedent, with a named actor.
4. **Not proposed, and recorded so it is not re-proposed as an oversight.** (a) *Making `drafts.league_id` nullable* — priced in D228(2) and rejected on measurement, not taste. (b) *A `mock_seats` table with a `draft_picks.team_id` FK change* — a schema change to the most-written table in the build, to avoid using a nullable column that already exists. (c) *A mock-scoped copy of the league's `teams`* — considered and rejected by the MS lane for its own reasons (MS §10 item 4); **note that MS's rejection was scoped to opening the two league verbs of its §2.2, not to standalone mocks**, so this lane is not contradicting it. (d) *Lowering `team_count` to match the seated franchises* — deforms the user's real league to run a throwaway, which is the bug (§2). (e) *A "quick mock" that skips persistence entirely* — Chris asked for a report that lasts (ruling 3.5), so a mock that leaves nothing behind answers a question nobody asked.
5. **An Architect correction of record, made rather than quietly edited away.** This session was briefed that the mobile More sheet's divergence from `MORE_ITEMS` was **drift**. Chris checked production on his phone: **the split is deliberate and form-factor driven**, the same flags govern both, and with current flags More is effectively just "My stats" on each. The characterisation is withdrawn, the unification proposal that followed from it is withdrawn, and what survives is the one mechanical note that is actually true — **two independently-authored files with nothing coupling them** (§1.6, F104). Recorded because the wrong version of this note would have bought a nav refactor nobody wants.
6. **A note for whoever writes `L.C6.1`:** MP.9's whole-schema vacuity proof is the natural home for any future *"does this write outside the practice"* question. Name it in the gate rather than leaving it as one more pgTAP file.

---

## 11. Open questions

**Q24 — where do mock reports live: a PRIVATE app surface, or the user's PUBLIC profile?** *(filed 2026-08-21 by the MP Architect session. **NON-BLOCKING** — every task ships the recommendation, so a ruling the other way is a route move and a visibility predicate, not a redesign.)*

**Why it is a question.** Chris's two rulings point at two different places and both are reasonable readings. Ruling 3.6: *"mocks should go to something on the **User's profile**, not at the league level."* Ruling 3.7: *"under the **More...** section there can be a Mock Drafts tab."* The first names the profile — and FieldScout profiles are **public, server-rendered** surfaces (`/u/[username]`, CLAUDE.md's SEO rule; the More sheet's own *My profile* row links there — `more-sheet.tsx:101–107`). The second names More…, which is **private app chrome**. **A mock report shows your strategy** — which players you paid up for, where you reached — and that is competitive information a league-mate could read the week before draft night.

**Options.** **(a) Private only** — `/app/mocks` + `/app/mocks/[id]`, reachable from More…, RLS-scoped to the launcher. **(b) Public profile tab** — `/u/[username]/mocks`, server-rendered, world-readable. **(c) Private by default with an explicit per-report share.**

**Recommendation: (a).** It satisfies ruling 3.7 exactly and satisfies ruling 3.6's *intent* — the reports belong to the **user**, not to a league — which is the contrast that ruling was drawing (*"However, real drafts should have a place at the league level"*). It is also the only option that needs no new visibility decision: `delete_mock_draft` is already launcher-keyed (`071:500–504`) and `drafts` RLS already scopes reads. **(c) is the natural follow-up if Chris wants sharing** and is cheap from (a) — a column and a predicate — whereas (b) makes every past practice public by default, which nobody asked for and which cannot be walked back for reports already published.

---

## 12. Ledger dispositions (every §6 row this lane touches, swept 2026-08-21)

| Row | Disposition in MP |
|---|---|
| **F32 / F40** — `commissioner_actions` does not exist until M6 | **Unchanged and untouched.** MP adds no commissioner control and no audit surface. |
| **F41** — §22.5 rate limits on draft actions | **Unchanged, and it now binds a second launch path.** MP.2's standalone launch counts against the **same** 3-active / 5-per-hour caps, counted the same way (`092:1249–1265`). **No new rate-limit surface**, and a Builder who adds one has changed §22.5 without a ruling. |
| **F76 / F92** — CPU pacing | **F76 is closed (AP.3). F92 is untouched by MP and becomes MORE load-bearing after §8:** with no bid-clock override, F92 is the remaining term in F85's arithmetic (13m17s on the default shape, measured by the AP.4 session). Named here so a reader of §8 does not mistake "Q23 resolved" for "the bar is met". |
| **F85** — the §8.8 under-45-minute mock-auction bar | **NOT discharged, and §8 says so in as many words.** MP.2's standardized 10-second preset is the necessary half; F92 is the other. |
| **F94** — the local player pool is empty after a `db reset` | **Unchanged, and it bites every MP pgTAP suite** (MP.1, MP.2 and MP.9 all draft players). Every suite **asserts its fixture is non-empty before asserting anything about it** — CLAUDE.md's "nothing happened means it worked" rule, of which F94 is an instance. Not discharged here. |
| **F98** — the MS lane clause in `ACTIVE-BUILD.md` | **Discharged 2026-08-21 by `1d4620d`, before this session.** Verified: `ACTIVE-BUILD.md` on `main` carries the MS rows and loop step **1b**. Named because **F102 is the same obligation for MP** and a reader should see the precedent worked. |
| **F101** — the commissioner cannot SWAP two draft slots | **Unchanged, real-league scope, explicitly out of MP (§6).** A mock inherits it for free once it exists, via D222's parity rule. |
| **F102** *(NEW — filed by this PR)* | **MP has no `ACTIVE-BUILD.md` lane clause, so `/build-next` cannot take `MP.*`.** This PR deliberately does not write one: **PR #180 rewrites the same block and the loop-order list**, and two concurrent edits there conflict in the file the loop reads first — F98's reason, unchanged. **Fix shape:** one lane block after MS's, plus a loop-order step, **and the §7 recommendation that MS+MP become one mock track that is a peer of the league lanes rather than sequenced behind AP** (Chris's ruling 3.8 read as sequencing — his call). **Discharged by a NAMED ACTOR: whoever merges this PR writes the lane clause as a follow-up commit on `main`, BEFORE the next `/build-next` cycle** (or folds it into #180's merge resolution, which touches the same block). *An unattended loop never surfaces an F-row as work, so a row with no actor is not a safety net.* |
| **F103** *(NEW — filed by this PR)* | **`featureFlags.leagues`' docblock describes a world that ended at M1.** `src/lib/feature-flags.ts:20` reads *"Leagues, league teams, and the live draft — mock-data UI, no backend yet."* The backend has shipped through M1, M2 and most of M3. Noticed while reading the file for §1.7 and **not** drive-by fixed (no adjacent edits). **Discharged by MP.3**, which is already editing that file to add `mockDrafts` and is the task a reader of the stale line would be working on. One-line fix. |
| **F104** *(NEW — filed by this PR)* | **The two "More" lists are independently authored and nothing couples them.** `sidebar.tsx:57–70` (`MORE_ITEMS`, consumed only at `:141`/`:250` — measured, `grep -n "MORE_ITEMS" -r src` → 3 lines) and `more-sheet.tsx:35–64` (inline `<Row>`s). **The split itself is deliberate and form-factor driven and is NOT a defect** (§1.6) — the defect is that an edit to one **silently misses the other with no type error and no test to catch it**. **Fix shape:** one cheap source-text pin asserting the two agree about the entries common to both, in the `elevation-rule.test.ts` / `draft-command-bar.test.ts:151–153` idiom. **Discharged by MP.6**, which edits both and must show the pin RED by adding the row to one file only. |
| **F105** *(NEW — filed by this PR)* | **The practice container is a `leagues` row that every league-enumerating surface must exclude — forever.** MP.2 adds the predicate to `listMyLeagues` (`leagues-service.ts:437`) and to every non-test enumeration it can find (`grep -rn "from('leagues')" src/lib src/app/api` → **114 sites**, mostly tests). **The standing residual is future surfaces**: standings, matchups, notifications, admin, and anything M4–M6 adds. **Fix shape:** the exclusion belongs in **one** shared read helper rather than repeated at call sites, and a pin asserting a user with a container sees the identical `/api/leagues` payload as one without. **Discharged by MP.2 for what exists today; the residual is carried forward and any task adding a league-enumerating surface owes it.** *(If Chris overturns D228 in favour of a nullable `league_id`, this row is withdrawn and replaced by the much larger obligation D228(2) prices.)* |
| **B5** — AP.4 blocked on Q23 | **CLEARED by §8** — Q23 resolves as "no override", from Chris's rulings rather than a new one. AP.4 closes with no code; its ten seconds moves to MP.2 item 3 and its remedy to MS.3. **PR #186 is a documentation-only halt record and should be resolved as answered rather than left standing.** |
| **Q17 / Q18 / Q22** | **Untouched.** Q17 is ruled and is not reopened — §8 satisfies it unamended. Q18 (the uncontestable-award copy) and Q22 (a mock's system chat posts) are non-blocking and belong to their own lanes. |
