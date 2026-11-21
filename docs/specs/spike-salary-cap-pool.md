# Spike — Weekly Salary-Cap Pool

| | |
|---|---|
| **Date** | 2026-11-17 |
| **Status** | SPIKE for Chris's review — no code, no accounts opened |
| **Branch** | `docs/spike-salary-cap-pool` (= `main` @ `08e7b65`; migration head 224, pgTAP head 174) |
| **Not legal advice** | This is research, not legal advice; a fantasy-contest attorney must confirm section 4 before any money is taken. |

**What triggered it** — Chris, in chat, 2026-11-17, verbatim:

1. "Maybe we hold off on Dual and instead just do like a weekly salary cap pool where anyone can come in and make a team under the salary cap for that week. And we just pay, or not pay, but we, you know, award the winners based on the total number of points they score. So we can have a couple different scoring systems. We can have a PPR one, and then we can have a different one. And we just score it at the end of the week. And we have like a leaderboard page that shows how, you know, who's in the lead and who's doing what. With the idea that, you know, each person can submit as many teams as they want. It's $5 per submission. And then we award, you know, all the winning, the top scoring. So like if there's like 1,000 people who all score, you know, the same number of points, we just split the pot amongst all of those people. And the platform just takes an automatic like 10% fee for running the game."
2. "Because yeah, we need a way to be making money before we can do something like Duel, because that's going to cost money to run it."
3. "So I would start with the highlight and do a spike on this salary cap league thing instead."

("Dual" = Duel, `spec-duel.md`; voice-typed.)

**Order this records:** Highlights is built first. Duel is on hold. This spike replaces the Duel data spike (PR #528's D-M0). The Highlights re-plan, including the player detail page from Chris's message 5, is a separate document and is not folded in here.

Confidence on each fact is marked **[H]** high, **[M]** medium, **[L]** low. "Contact sales" and "unknown" mean exactly that.

---

## 0. The short answer

**(a) Can we build it?** Yes. It's DraftKings' and FanDuel's weekly salary-cap contest, and most parts already exist here. The free version is about two to three weeks of build work.

**(b) Scored from our data, waking only for games?** Yes: prices from projections we pull, results from stats we store, on a check that already runs daily.

**(c) What stands between us and $5:**
1. **A lawyer**, first. It depends on your state.
2. **A payment company.** Stripe forbids paid fantasy; PayPal needs approval. Per-entry card fees eat about 45¢ of your 50¢.
3. **States.** Five are out (WA, ID, MT, NV, HI); our base tracker also lists California (its attorney general called them illegal in 2025; DraftKings and FanDuel still operate there). FL and TX are contested. Licences: $0–$3,000 cheap, $50,000–$250,000 big, plus age, ID and location checks.
4. **Data and hosting.** Sleeper's stats feed and Vercel's free plan are licensed for non-commercial use, so a paid game needs licensed stats and a paid hosting plan.

Year one: roughly $13,000–$145,000+, about $55,000 expected, before state fees and data (low confidence; possibly well above).

**(d) Does "pot minus 10%, ties split" work?** Possibly not as is; a lawyer must confirm. On the plain wording, a pot of 90% of entries looks like the kind of prize federal law's fantasy exception rules out. The usual industry answer is a capped contest with a posted prize (1,000 entries, $4,500 to the top score, ties split). Whether your design fails, and whether that fix is enough, is the lawyer's first question. New York limits each person to the lesser of 150 entries or 3% of the contest (30 in a 1,000-entry contest). Your design stays the ask unless the lawyer says otherwise.

**(e) Recommendation.** Build the free game first, switched off for everyone but testers until you turn it on. Money comes later, as a separate layer, after a lawyer's answer, a processor's approval and your go.

**(f) Your decisions:** your state; a regulated business or not; lawyer budget; free first (prize or not); the (d) tweaks if required; paying for data and hosting; game shape (section 7).

---

## 1. The game as you described it

1. Anyone can come in and make a team for that week. **You said.** Whether it's a public contest rather than a league, and whether there's one contest per week (per scoring system), is **open**; defaults: a public contest, one per system per week.
2. You make a team under a salary cap for that week. **You said.**
3. Winners are decided by total points scored. **You said.**
4. There are a couple of scoring systems: a PPR one and a different one. **You said.** *Which* second system is **open**.
5. It's scored at the end of the week. **You said.** When "end of the week" becomes final, and whether points show live during games, is **open**.
6. A leaderboard shows who's in the lead and doing what. **You said.** When rivals' teams show is **open**.
7. Each person can submit as many teams as they want. **You said.**
8. It's $5 per submission. **You said.**
9. The top score wins, and everyone tied at the top splits the pot. **You said.** Whether ties split per entry or per person is **open**.
10. The platform takes an automatic 10% fee. **You said.**
11. "We just pay, or not pay, but we… award the winners": whether the first release involves money at all is **open**.
12. The purpose is to make money before Duel, which costs money to run. **You said** (message 2).
13. Roster, cap, prices, lock timing, editing, minimum entries: **open**.

**Open design choices**

| Question | What DraftKings / FanDuel / ESPN do | Recommended default |
|---|---|---|
| Roster | DK: QB, 2 RB, 3 WR, TE, FLEX, DST, no kicker [H]; FD similar [M] | DK's 9, no kicker |
| Cap and prices | DK $50,000, prices about $2,000–$8,000 [H/M]; FD $60,000 [M]; Duel PRD 10,000 credits | $50,000 scale (section 3); dollar salaries can be confused with real money later |
| Second system | DK full PPR with +3 bonuses at 300 pass / 100 rush / 100 rec yards [M]. FD half-PPR [M] | Half PPR from our existing preset, no bonuses, as a **separate** contest with its own prices |
| Contest window | Full-week slates exist; flagship is Sunday's main slate [M] | Thu–Mon, one contest per system per week |
| Lock | DK "late swap": each player changeable until his own game starts [M] | Each player locks at his own kickoff (our league rule) |
| Edit / withdraw | DK allows edits until lock [M] | Edit any player who isn't locked; withdraw the entry until its first player locks |
| Entries per person | DK caps 1–150 per contest, and sub-$5 contests at 20 [M] | Free game: unlimited, as you said. Paid: the lawyer decides (section 4.3) |
| Places paid | DK runs winner-take-all to 50/50s [M] | Top score only, as you said |
| Ties | No DK-wide rule found; tied entries share the combined prizes for the tied places [L] | Everyone tied at the top shares first place (ranks 1, 1, 3); split per entry |
| When final | ESPN applies corrections to the following Saturday [M]; DFS freezes at settlement [M] | Free game: provisional Tuesday; final the morning after next Thursday's games start (the next daily check); our own stat fixes still re-score, as your 2026-11-07 ruling does for leagues. Paid game: no default; question for you and the lawyer (SP-Q18) |
| Rivals' teams | DK shows lineups after lock and ownership % [L] | A rival's player shows once his game kicks off; yours always show |
| Live points | Not researched | End of week only, as you said (a live step can be added later with no new wake) |
| Unfilled contests | DK: cancel and refund, or guarantee [M]; Yahoo guarantees "will always run" [H] | Free: no minimum. Paid: cancel and refund |

---

## 2. What we already have and what is new

**Reuse** (all [H], read on `08e7b65`)

| Capability | Exists at | Missing |
|---|---|---|
| Weekly projections | `src/lib/sync/weekly-projections.ts:166-198`; migration 136 | Prices; a locked snapshot (rows are overwritten on every fetch, even after kickoff) |
| Score a projection / actual stats (one engine) | `src/lib/leagues/scoring/player-values.ts:266-272`; `src/lib/players/preset-scoring.ts:53` (`ppr`, `half_ppr`, …), `:160-166` | Nothing (a Scout preset key only if wanted) |
| Stats arriving + our stat fixes | `src/lib/sync/ingest-week.ts`; migrations 167, 222, 223 | A contest re-score hook (222 covers league rows only) |
| Week calendar + correction window | migrations 039, 158 | Nothing |
| Per-player kickoff lock | `184_game_status.sql:515`; 200 (bye never locked); 154 door + trigger pattern | A lock helper with no league argument |
| Rate limits, flags, nav | 213 (HEAD), `feature-flags.ts:13-17`, `sidebar.tsx:32-100`, `mobile-dock.tsx:170-176` | A `contest` bucket, a flag, nav entries |
| Notifications, admin | `001:540-551` (helper `063` swallows errors); `182`, `212:2453` | A notification renderer; contest verbs |
| Leaderboard, picker, cap meter, slots | `standings-table.tsx:52`, `auction-player-table.tsx`, `auction-budget.ts`, `lineup-editor.tsx:200` | Variants: ties, salary column, can't-afford and locked states |
| Pricing rule | Duel PRD only (`spec-duel.md`:78-79; its multiplier targets the best-projected **full squad, bench included** (12–14 players), at about 14,000 under a 10,000 cap) | All code, and a target for an 8-man no-bench game (Duel has none; see section 3) |
| Payments | None (`src/lib/stripe/.gitkeep`; unused `stripe_customer_id`) | Everything in section 4 |

**Data model (proposal).** RLS on every table, no client write policy, TRUNCATE revoked; writes only through SECURITY DEFINER doors.
- `contests`: season/week (FK `nfl_weeks`), `system`, `cap`, `roster_shape`, `status` (draft → open → live → provisional → final, or void; forward only), `prices_frozen_at`, `final_at`. **No money columns.**
- `contest_prices`: (contest, player) → salary, frozen position/team/projection; immutable once frozen.
- `contest_entries`: user, `salary_used`, `points`, `final_rank`, `withdrawn_at` (soft delete); no per-user uniqueness (unlimited entries).
- `contest_entry_players`: (entry, slot) → player, salary paid; a player once per entry.
- `contest_player_points`: (contest, player) → points (NULL = pending/refused line).
- **Cap, slots and locks are enforced** in `contest_save_entry` / `contest_withdraw_entry` (server sums its own prices; lock via `lineup_kickoff_internal`), re-proved by a BEFORE trigger. The builder greys out what can't be picked, so refusal is only a backstop.
- **Leaderboard RPC:** RANK() (ties share a place), keyset paging (no 1,000-row cap), rivals' players masked until kickoff.
- **Naming:** "pool" already means the league player pool in SQL/TS (`pool_game_lock_*`, `league_player_pool`), so new tables and functions use `contest_` (or `contests`).

**Jobs and wake cost under the 2026-11-14 rule**

| Job | Carrier | Added wakes |
|---|---|---|
| Create + price contests, freeze | **Recommended:** the daily 11:00Z sweep (`sync-live?sweep=daily`). Alternative: the hourly projections ping (`136:151`), which runs 24/7 outside your rule | 0 |
| Lock | Computed at save time from kickoff; no job | 0 |
| Live points (only if you want them) | A step inside score-week's existing 30 s game-window pass (~2,300 ticks a week); est. 0.5–2 min Active CPU a week [L] | 0 |
| Settle: provisional Tue, final after the correction window | Daily 11:00Z sweep, one pass each (final lands the morning after next Thursday's games start) | 0 |
| Our own stat fixes after final | Next daily sweep, using 222's delta method | 0 |

Database housekeeping is a separate item, outside this document.

**Free-version task list**

| ID | Title | Size | Rigour | Migration | Depends on | Scope | Older schema |
|---|---|---|---|---|---|---|---|
| SP.0 | PRD + your rulings | S | ONE PASS | – | – | Your words and answers; no code until ruled | n/a |
| SP.1 | Schema + RLS + lock helper | M | FULL | 225 | SP.0 | Five tables, status trigger, lock helper | Additive only; nothing reads the tables until SP.2+, and every reader checks for them and says "not set up" loudly |
| SP.2 | Pricer + weekly contest creation | M | FULL | – | SP.1 | Pure TS pricer, freeze once, in the chosen carrier | If the tables are missing, the step logs "contest tables not present" and the projections run still succeeds |
| SP.3 | Entry doors + trigger + rate limit | L | FULL | 226 | SP.1 | Save/withdraw, every refusal named | Routes return a named 503 "not available yet" when the RPC is missing (PGRST202), never an empty success |
| SP.4 | Scoring + settle + stat-fix re-score | L | FULL | 227 | SP.1, SP.3 | One engine; provisional/final; live only if ruled | Step skipped with a named log line when tables/doors are missing; the league scoring pass it rides never fails because of it |
| SP.5 | Leaderboard + entry-detail RPCs | M | FULL | 228 | SP.1 | Ties, keyset paging, masking | Page shows "not available yet" on a missing function (PGRST202) |
| SP.6 | Desktop hub + builder + cap meter | M | ONE PASS | – | SP.3 | Reuses auction table, slot rows | Behind the flag; shows the RPC's named "not available" state |
| SP.7 | Desktop entries, leaderboard, results | M | ONE PASS | – | SP.5, SP.6 | StandingsTable variant, pinned "you" row | As SP.6 |
| SP.8 | Mobile screens | M | ONE PASS | – | SP.6, SP.7 | `ByLayout`, sheet builder, `m-*` tokens | As SP.6 |
| SP.9 | Flag + nav | S | ONE PASS | – | SP.6 | Sidebar row; phone Home card + Profile | Flag off in production until you switch it on |
| SP.10 | Admin page + operator verbs | M | FULL | 229 | SP.4 | Void, re-settle, add at floor | Admin page shows "not available" on missing functions |

**Total:** 11 tasks, 5 migrations (225–229, re-measure at build time), no new cron job, no new Vercel wake, about 9–13 agent-days. The money layer is not included.

**Screens.** Desktop: contest hub, team builder (salary column, cap meter, slots with lock badges), My entries, leaderboard (rank, entry, manager link, points, status), results, admin. Phone: the same flows as `ByLayout` screens, builder in a sheet, reached from a Home card and Profile.

---

## 3. Real numbers from this week

Read-only reads of the hosted database, 2026-11-17 ~19:46Z, independently re-run. **Prices use the Duel PRD's 8 starting slots (QB, 2 RB, 2 WR, TE, 2 FLEX; no K/DST) and 10,000-credit cap, not DK's 9**; DK's shape would change the multiplier. **The price table is illustrative.** Duel's rule targets a full squad of 12–14 players including bench; an 8-man game with no bench has no Duel constant to reuse, so the target below (best 8 cost about 14,000, i.e. about 140% of the cap) is this spike's own assumption (SP-Q10). PPR math mirrors our ESPN Full PPR preset, hand-checked on three players.

- **Coverage [H]:** 418 week-11 projection rows; every depth-chart starter at QB/RB/WR/TE is projected.
- **Duel formula, spike's target:** price = clamp(round-to-50(projection × multiplier), 300, 3,000), with the best-projected 8-man lineup set to cost 14,000 (the spike's assumption, not Duel's full-squad rule). The multiplier comes out at **84** [H]. The best-projected 8 score 166.16.
- **Floor and ceiling [H]:** 180 of 367 priced players (49%) sit on the 300 floor (anyone projected under about 3.87). Nobody reaches 3,000; the top price is 2,100. **Under this assumption the 300–3,000 bounds don't fit and would need tuning.** For comparison, DK's top-to-floor ratio is about 4×.

| Position | Players | Min | Median | Max | At floor | $50k scale min / median / max |
|---|---|---|---|---|---|---|
| QB | 26 | 650 | 1,400 | 2,100 | 0 | $3,250 / $7,000 / $10,500 |
| RB | 96 | 300 | 400 | 2,000 | 43 | $1,500 / $2,000 / $10,000 |
| WR | 148 | 300 | 300 | 1,900 | 75 | $1,500 / $1,500 / $9,500 |
| TE | 97 | 300 | 300 | 1,250 | 62 | $1,500 / $1,500 / $6,250 |

**Priciest (credits / $50k scale):** Burrow QB 2,100 / $10,500; Allen QB 2,050; Gibbs RB 2,000; Lamb WR 1,900; Mahomes QB 1,850; Prescott QB 1,800; Chase WR 1,750; Daniels QB 1,750; Stroud QB 1,750; C. Williams QB 1,700. Six of the top ten are quarterbacks.

**Best lineup under the cap (approximate, because it's a projection) [H for the arithmetic]:** Herbert 1,300; McCaffrey 1,650; B. Hall 1,000; Chase 1,750; Jefferson 1,550; Higgins 1,500; Downs 700; D. Washington 550. That is **exactly 10,000 credits ($50,000), 121.07 projected** (73% of the uncapped 166.16). On the $50,000 scale the best-projected lineup costs about $70,000.

**Last week (week 10, actual PPR) [H]:** McCaffrey scored the most (46.30, hand-checked). The perfect uncapped lineup scored **300.52** (week 9: 256.38). Priced on week-10 projections, the best lineup that fit under 10,000 scored **269.42**. That figure is illustrative only [M/L], because those projections were refetched after the games. A winning score lands in the 200s.

**When a week's stats stop changing [H on counts, M on what they predict]:** weeks 6–9 had 2, 8, 5 and 3 correction events. The organic ones landed 12–42 h after the last game, and only one changed an offensive PPR score (−0.1). The only later scoring change was our own importer fix (−1.5 on one player). Closing results at the existing window, next Thursday's kickoff (about 65 h after Monday night), would have caught every organic change. Those timings were measured under the old hourly cadence; migration 224 now checks daily and once more 15 minutes before the window closes.

**Storage [M]:** 1,000 entries a week for 18 weeks is about 15–35 MB a season plus ~2 MB of prices; not a constraint.

---

## 4. Taking money: what it requires

*Research for Chris and his lawyer, not legal advice.*

### 4.1 Federal law and the prize structure

UIGEA's fantasy carve-out (31 U.S.C. 5362(1)(E)(ix)) says a contest is not a "bet or wager" only if, among other conditions: **"All prizes and awards offered to winning participants are established and made known to the participants in advance of the game or contest and their value is not determined by the number of participants or the amount of any fees paid by those participants."** [H, verbatim]. Its other conditions (skill; individuals' accumulated stats across multiple real games; no single-team or single-performance outcomes) appear to fit a week-long NFL salary-cap lineup [M]; that is also for the lawyer (4.9 #1).

**How "90% of whatever comes in" sits against it:** on the plain wording, 90% of entry fees is a prize whose value is determined by the number of participants and fees paid [H]. New York's statute (PML 1404(1)(n)) has the same rule [H]. Failing the carve-out isn't by itself a federal crime (that needs some other state or federal violation) [M], but state statutes copy the rule and processors screen against it.

**The standard fix [M]:** each contest has a maximum entry count and a prize table posted before entry; if it doesn't fill, cancel and refund, or guarantee it and cover the shortfall. To keep your economics, post 90% of a full contest: 1,000 entries max at $5, top score wins $4,500, ties split. Several sizes can run side by side. The FFPC caps entries for this reason [M].

Also: IGBA turns a state-law violation into a federal crime when five or more people run the business and it runs 30+ days or takes $2,000 in a day [H].

### 4.2 States

As of 2026-11-17. Base: Vela Wood tracker (2026-02-12) plus 2026 changes.

| Group | States | Cost / notes |
|---|---|---|
| Operators stay out | WA, ID, MT, NV, HI | MT statute bars internet fantasy wagering [H]; WA Commission says illegal [M]; NV wants a sports-pool licence [H] |
| Contested | CA (Vela Wood lists it as not allowed; AG opinion 2025-07-03: DFS = illegal betting wherever the operator is, class actions filed [H]; DK and FD still operate there [M]); FL (2023 cease-and-desists to props operators; no 2026 law) [M]; TX (2016 AG opinion) [M]; OR (DK out, FD in) [M]; UT, WV caution [L] | Lawyer decides; default is to geofence them out |
| Cheapest licensed | CO $350 registration under 7,500 users, no tax [H]; IL $500 small tier, 15% tax, 21+ (from 2026-07-01) [M]; OH $3,000 under 5,000 players, up to 3 yr, no tax [H]; AZ $2,000/2 yr, 5%, 21+ [M]; ME: licence required; no fee and no 10% under $100k gross fantasy revenue; 10% above it [M] | First wave ≈ **$5,850** in fees [M] |
| Mid-cost | AL $1,000 (10.5%, 19+); LA $1,000 (8%, approved parishes); TN $300 + $1,000+ (6%); IA $5,000 (6.75%, 21+); MS $5,000 (8%); MO ≤$10,000 (6%); MI $10,000 + $5,000/yr (8.4%); NJ $500 + $5,000–$50,000 permit; VT $5,000/yr; AR none (8%); KS none listed [M/L] | $1,300–$32,000 depending on mix |
| Expensive | PA $50,000/5 yr (15%); VA $50,000/3 yr (10%, rules possibly not until 2029); IN $50,000; DE $50,000/yr; CT $250,000 [M] | $50,000–$250,000 each |
| Licensed, fee unknown | NY (15% + 0.5%) [H]; MD (15%), MA (15% reported, 21+), KY (new 2026 licence, 12.5% reported), NH, WY [L] | Unknown |
| No regime, generally allowed | AK, GA, MN, NE (19+), NM, NC, ND, OK, RI, SC, SD, WI; DC unclear [M/L] | No fee; more uncertainty |

**Home-state question [M]:** state law applies where the *player* is located (California's AG says the operator's location doesn't matter). Separately, running the business *from* a prohibited state (e.g. Washington, where transmitting gambling information online is a felony) is a risk even with its residents geofenced out, and incorporating elsewhere doesn't by itself cure it. First question for the lawyer.

### 4.3 Duties on the operator, and where your design collides

| Duty | Rule | Collides with |
|---|---|---|
| Per-person entry cap | NY: lesser of 150 or 3% of entries, every contest [H]. MA: same for contests over 100 entries; one entry in contests of 12 or fewer; unlimited only with disclosure and a $50+ fee [M/L]. MS similar (unverified) [L] | **"As many teams as they want"** |
| Age | 18 in most states; 19 AL/NE; 21 AZ, VA, IL, MA [M] | "Anyone can come in" |
| Location | Eligibility is decided by physical location at entry; KY requires geolocation [M]; card networks reportedly want certified location checks [M] | "Anyone can come in" |
| Identity | One account per player; KYC; collusion and script bans; self-exclusion; 5-year records; complaint response within 48 h / 10 business days (NY) [H] | Unlimited entries make multi-accounting matter once prizes exist |
| Player funds kept separate | NY segregated and insolvency-protected [H]; TN reserve ≥ balances + prizes owed [H]; IA segregation **and** a reserve [M]; OH rules [M] | The pot is held from entry to payout; move the 10% to operating only after settlement |
| Experienced-player labels, audits | MA, MS (unverified), KY audits [L] | Build items |

### 4.4 Payments

| Provider | Paid fantasy with cash prizes | Confidence |
|---|---|---|
| Stripe (incl. Connect) | **Prohibited**, no approval path (policy updated 2026-09-22) | H |
| Square | Likely prohibited: US terms bar sports-related gambling but don't name fantasy; the AU page names fantasy buy-ins | M |
| PayPal / Venmo | Advance written approval; must show state blocking. Splash takes PayPal/Venmo, so approval is achievable for an established operator | M |
| Braintree, Adyen | Unknown — contact sales | L |
| Paysafe, Aeropay (pay-by-bank), Nuvei | Serve fantasy; contact sales; expect to be asked for licences | M/L |

Card networks: Mastercard registration for skill-game merchants is reportedly **$1,000/yr** from 2026-05-01, plus possibly $0.02 + 0.10% per transaction [M, secondary source].

**Unit economics of a $5 entry with a 10% fee (= $0.50 to FieldScout)**

| Collection model | Cost per entry | Left of $0.50 |
|---|---|---|
| Card, Stripe-level 2.9% + $0.30 (benchmark only) | $0.145 + $0.30 = **$0.445** | **$0.055** |
| Card, high-risk at an assumed 4% + $0.30 | $0.50 | $0.00 |
| Pay-by-bank at about 1.25% + $0.20 | $0.0625 + $0.20 = $0.26 | **$0.24** |
| ACH at 0.8% | $0.04 | $0.46 |
| $20 card deposit funding 4 entries | $0.88 ÷ 4 = $0.22 | $0.28 (but a stored balance raises money-transmission questions) |

Then subtract the state tax on the fee (15% × $0.50 = $0.075) and possibly the federal excise (0.25% × $5 = $0.0125): pay-by-bank in a 15%-tax state leaves **about $0.15 per entry**. One accepted card dispute ($15 fee + $5 reversed) erases the fee from about 40 entries [H, Stripe benchmark]. Paying each tied winner weekly costs about $2.26 per winner at Connect-style pricing [H, benchmark], half of a $4.50 share; a balance avoids that but means holding players' money. Whether holding entries makes FieldScout a money transmitter is a lawyer question [M].

### 4.5 Tax paperwork

- 1099-MISC for players whose 2026 winnings reach **$2,000** (up from $600; indexed from 2027) [M]. Yahoo reports **net** winnings [M]. Collect a W-9/TIN before paying prizes that could cross the line.
- Form costs about $3.10 federal and $1.49 state per form (Avalara) [M]. CPA about $500–$3,000/yr [L].
- Operator revenue tax of 0–15.5% of the fee by state; federal excise 0.25% (state-authorized) / 2% if the IRS's non-binding AM 2020-009 position applies (Form 730 question) [M]. Sales tax on the fee: unknown.

### 4.6 Data, photos and logos in a paid game

- **Sleeper:** "free to use for non-commercial purposes"; commercial use means contacting Sleeper [H]. Sleeper runs its own paid fantasy. What a paid game needs from Sleeper, or from a licensed feed instead, is a lawyer question (4.9 #8). **Salaries from Sleeper projections carry the same limit** [L].
- **nflverse:** CC-BY-4.0, commercial use with attribution [M], but NFL data "belong to their respective owners" [H] and there's no SLA [L]. Fine for a cross-check, an in-house projection model or the free game; as the official paid source, a lawyer question.
- **Licensed feeds:** MySportsFeeds from CA$39/mo, box-score add-on unpriced [M]; Goalserve $300/mo or $1,200/12 mo on sale [M]; SportsDataIO and Sportradar contact sales.
- **Names and stats:** courts allowed paid fantasy to use them without a licence (C.B.C. v. MLBAM, 8th Cir. 2007 [H]; Daniels v. FanDuel, Ind. 2018 [H]). C.B.C. binds only the 8th Circuit; Daniels applies Indiana's statute. Whether they cover a national paid contest is a lawyer question (4.9 #9).
- **Headshots and logos:** photos are separately copyrighted, and 6+ players' pictures together is NFLPA group licensing [M]; NFL logos are trademarks [M]. Image licensing for headshots and logos is a lawyer question (4.9 #9). **Recommended default for the paid surface: names, positions, team abbreviations and stats only.**
- **Wording:** "sports pool" is a betting term in gaming statutes (NRS 463.0193) [H]. DK and FD say "contest / entry / prize." Get a trademark search on the name.

### 4.7 Hosting

- Vercel Hobby is "personal or non-commercial use" only [H]. Pro is $20/seat/month plus usage beyond the $20 credit [H].
- Supabase's AUP bars "facilitating unregulated gambling and wagering activities" [H]. Pro is from $25/month [H].
- Base cost is about **$540/yr**, plus usage.

### 4.8 Year-one cost and time to the first paid contest

| Item | Low | Expected | High | Conf. |
|---|---|---|---|---|
| Fantasy/gaming lawyer | $7,000 | $20,000–$30,000 | $56,000 (+$2,000–$10,000/yr) per payments research; law research: $10,000–$50,000 plus **$10,000–$150,000 a year** (vendor/blog estimates). Get quotes | L |
| Geolocation | per-check only, minimum unknown | ~$12,000/yr | $60,000+/yr | L |
| ID / age checks | $0 (Persona startup program, 500/mo free; eligibility judged on use case) | $0–$3,000 (no midpoint) | ~$3,000 | M |
| Processor setup + monthly | $0 | unknown | $2,500 + $6,000/yr | L |
| Card-network registration | $0 (bank-only) | ~$1,000 | ~$1,000+ | L |
| Hosting (Vercel Pro + Supabase Pro) | $540 | ~$1,000 | ~$1,500 | H |
| LLC, accounts, CPA, 1099s | ~$600 | ~$2,000 | ~$5,000 | M |
| Insurance | $1,000 | ~$2,500 | $5,000 | L |
| **Total (payments research, excl. the two rows below)** | **~$13,000** | **~$55,000** | **~$145,000+** (could run well above this on the law research's lawyer range) | L |
| *Not in total:* State fees (first wave → + mid-cost) | $0 (unregulated only) | ~$5,850 | ~$38,000 | M |
| *Not in total:* Stats licence | ~US$340 + add-on (MySportsFeeds) | $1,200 (Goalserve 12 mo) | contact sales | M |

Not included: the player-funds reserve (held money, not a cost), bond fees and audits (unknown), and state tax of 0–15.5% of the fee.

**Time to the first paid contest (estimate, low confidence).** The free game is 9–13 agent-days. The paid layer waits on a lawyer's memo, an entity, processor onboarding (timeline unknown), state registrations (timelines unknown; Virginia's rules may not come until 2029), and geolocation and ID integration. The 2026 regular season has about seven weeks left, so **the realistic first paid week is in the 2027 season.**

### 4.9 Questions for the lawyer

1. Does a pot of 90% of entry fees fail 5362(1)(E)(ix)(I) and state equivalents? Does a fixed-size contest with a posted prize (cancel and refund if unfilled) comply? Do the carve-out's other conditions fit a week-long salary-cap lineup?
2. Can Chris lawfully run a paid contest from his home state?
3. Which unregulated states are safe for a small operator; which of CA, FL, TX, OR, UT, WV to geofence?
4. Current fees, timelines, background checks, reserves and audits in CO, OH, IL, AZ, ME.
5. Per-person entry caps by target state.
6. Segregated account vs reserve vs bond; when the 10% can be withdrawn; money-transmitter exposure (per-entry vs stored balance).
7. IRS excise (Form 730); 1099 net vs gross at $2,000 for 2026.
8. What stats and projections licence does a paid contest need? Can Sleeper or nflverse data settle a paid contest; must the stats source, settlement time and correction policy be published or contracted? In a paid contest, do results freeze at a published settlement time, or may our own later stat fixes change them?
9. Player names/stats nationally; headshots, logos and NFLPA/copyright.
10. Does running paid contests on Splash Sports shift the burden to Splash?
11. A free contest with a FieldScout-funded prize: official rules, eligibility, NY/FL registration or bond; running it alongside paid ones.
12. Entity structure and insurance processors expect; trademark clearance on the name.

---

## 5. Ways this game could make money, lightest to heaviest

For comparison, Duel's feed: the plan budgeted a Tank01 trial at $10–$25/month [L]; production candidates are Goalserve at $300/month [M] (about **$69/week**) and Sportradar at contact sales (third-party estimate $500–$1,000+/month, unverified).

| Option | What it is | Who does it | Must be cleared first | Cost to start | Fee left per week at 200 / 1,000 / 5,000 entries, after processing and state tax (before payouts, ID/location checks and reserves) |
|---|---|---|---|---|---|
| **A. Free, no prize** | Leaderboard and bragging rights | Small sites (OwnersBox, FFQuest) [M] | No gaming clearance | Build only | $0 / $0 / $0 |
| **B. Free, with a prize FieldScout or a sponsor funds** | Fixed prize under official rules, no purchase necessary | DK free contests [L]; ESPN Pick'em $102K/season [M]; Sports Geek $500/week [M] | Official rules and eligibility (counsel); NY/FL registration and bond, RI registration, for chance promotions over $5,000 [M]; whether a skill contest is covered is a lawyer question; W-9 at $2,000; Vercel Pro likely ("commercial" undefined) | Prize (e.g. $500/week = $9,000/season) + rules drafting (unknown) | Net −prize; sponsor income unknown |
| **C. FieldScout never holds the money** | (i) Run the paid contest on Splash Sports, which collects and pays and keeps 10% (12.5% with commissioner rewards: 7.5% Splash, 5% to the commissioner; base unclear) [M]. Whether Splash offers a salary-cap format: unknown. (ii) Flat software fee per league (MFL/Fantrax ~$90–$150/season) [L], which fits private leagues, not a public contest | Splash, LeagueSafe, MFL | Lawyer on what FieldScout may do as "commissioner"; Splash terms; Splash's own excluded states (12–19) | Low | (i) at 5% of $5: **$50 / $250 / $1,250** |
| **D. Affiliate referrals** | Paid per new depositor sent to a DFS site | Many media sites | NJ/PA affiliate registration ($0–$3,000) [M] (sportsbook-affiliate rules; whether they reach DFS referrals is unverified) | Low | DFS pays ~$25–$200 per depositor [L], not per entry |
| **E. Paid entries in cleared states** | FieldScout is the operator | DK, FD, Splash | Everything in section 4 | ~$13,000–$145,000 year one [L] | Fee $100 / $500 / $2,500; after pay-by-bank ~**$48 / $240 / $1,200**; after a 15% state tax ~$30 / $150 / $750 |

**Against Duel's feed:** Goalserve at $69/week is covered by about 289 paid entries a week at $0.24 net each (139 at the full $0.50). But option E's expected year-one fixed costs (~$55,000) need about **12,700 entries a week** at $0.24 over 18 weeks just to break even (low-confidence inputs). Option C(i) covers $69/week at about 280 entries a week, if the 5% base is entry fees.

**Recommended path (recommendation):** ship **A** now. Have the lawyer's first memo answer **B**, **C(i)** and **E** together. Add a small funded prize (B) once counsel has written the official rules. Choose C(i) or E only on counsel's answer and on how many people actually play the free game.

---

## 6. Recommended sequence (recommendation)

1. **Now:** Highlights, per the separate re-plan. Database housekeeping is a separate item, not yet filed; recommended before new features, your call.
2. **Free weekly contest behind a flag** (SP.0–SP.10) after Highlights, on your go. It's the same game either way and builds the audience a paid version needs. No money columns, but the seams the money layer needs are kept: status machine, soft withdraw, one save and one withdraw door, `final_rank` stored at final.
3. **Money layer = a separate later milestone**, gated on all three of: a lawyer's written answer (section 4.9), a processor's approval, and your go. Until then: no Stripe, no balances, no prizes tied to entries.
4. **Parked:** Duel and its feed spend (PR #528's NP-Q2).
5. **PR #528's plan:** Duel milestones go on hold, with this spike replacing the Duel data spike (D-M0). The Duel pricing rule (D.6.1) and roster-builder ideas are reused in SP.2/SP.6, so Duel can later reuse the pricer with its own constants. Highlights, including the player detail page, goes ahead per its re-plan.

---

## 7. Questions for Chris

Each has a recommended default (a recommendation, not a decision).

**Money first**
- **SP-Q1 — Which state do you live in, and which would the business run from?** *Default: answer first. If it's WA, ID, MT, NV, HI or CA, get the lawyer's view before building any money part.*
- **SP-Q2 — Are you willing to form and run a regulated contest business** (LLC, separate players'-money account, registrations, ID/age/location checks, tax forms)? *Default: decide after the lawyer's first memo.*
- **SP-Q3 — Budget for a fantasy-contest lawyer?** *Default: a scoped first memo on 4.9 #1–3 and #10–11; get quotes (research ranges $7,000–$56,000 one-time, or $10,000–$50,000 plus $10,000–$150,000 a year ongoing [L]).*
- **SP-Q4 — Free version as step one, with or without a prize you fund?** *Default: free, no prize at launch; add one after counsel writes official rules.*
- **SP-Q5 — If the lawyer requires it: a posted prize per contest size (full contest pays 90%; cancel and refund if unfilled) and a per-person entry cap in paid contests?** *Default: keep your design as the ask; accept the standard fix if required.*
- **SP-Q6 — Run the paid version on Splash Sports instead of handling money ourselves?** *Default: ask the lawyer about both routes in one memo.*
- **SP-Q7 — Pay for licensed stats, Vercel Pro and Supabase Pro once money is involved?** *Default: yes; get written confirmation from the feed that paid scoring is allowed; ask Sleeper about commercial terms.*
- **SP-Q18 — In a paid contest, do results freeze at a published settlement time (what DFS sites do), or do our own later stat fixes still change them?** *Default: none until the lawyer answers.*

**Game design**
- **SP-Q8 — Besides PPR, which scoring does the second contest use?** *Default: Half PPR, as its own contest with its own prices.*
- **SP-Q9 — Which positions do you fill?** *Default: DraftKings' 9 (QB, 2 RB, 3 WR, TE, FLEX, DST), no kicker.*
- **SP-Q10 — How big is the cap, and how far over it would the dream lineup be?** *Default: a $50,000 cap. How much the best-projected lineup should cost is open: the spike's illustrative prices assume about 140% of the cap, its own assumption, not Duel's rule; tune in playtests.*
- **SP-Q11 — Can you swap a player until his own game starts, or does your whole team lock at the first kickoff?** *Default: each player locks at his own kickoff.*
- **SP-Q12 — Do points show live during games, or only at the end of the week?** *Default: end of week, as you said.*
- **SP-Q13 — When are a week's results final in the free game?** *Default: provisional Tuesday, final the morning after next Thursday's games start; our own stat fixes still re-score, as in leagues. (Paid: SP-Q18.)*
- **SP-Q14 — When can you see a rival's players?** *Default: each one once his game kicks off; yours always show.*
- **SP-Q15 — When does a week's contest open and its prices stop moving?** *Default: Wednesday morning, via the existing daily check.*
- **SP-Q16 — What is the game called, and what words does it use?** *Default: "contest / entry / prize", not "pool / pot"; you pick the name.*
- **SP-Q17 — Where do players find it?** *Default: a desktop sidebar row; a Home card and Profile on the phone.*

---

## Appendix: sources

**Federal**
- 31 U.S.C. 5362 — carve-out text, unlawful-gambling definition [H]: https://www.law.cornell.edu/uscode/text/31/5362
- 18 U.S.C. 1955 (IGBA) [H]: https://www.law.cornell.edu/uscode/text/18/1955
- IRS AM 2020-009 excise (Fox Rothschild) [M]: https://foxrothschild.gjassets.com/content/uploads/2020/10/Daily-Fantasy-Sports-Are-Wagers-Subject-To-Excise-Tax_all.pdf
- 1099 threshold $2,000 [M]: https://www.avalara.com/us/en/blog/one-big-beautiful-bill-act-1099-reporting-threshold.html

**States**
- State categories, PA/CT/AZ/IN/DE/ME fees (Vela Wood, 2026-02-12) [M]: https://velawood.com/tracker/fantasy-sports-legislation-tracker/
- NY PML 1404 — prize rule, entry cap, player funds, duties [H]: https://www.nysenate.gov/legislation/laws/PML/1404
- Colorado fees [H]: https://sbg.colorado.gov/fantasy-contest-fees · Ohio 3772-74-07 [H]: https://www.law.cornell.edu/regulations/ohio/Ohio-Admin-Code-3772-74-07 · Ohio R.C. 3774 funds [M]: https://codes.ohio.gov/ohio-revised-code/chapter-3774
- Illinois SB 3019 [M]: https://www.hklaw.com/en/insights/publications/2026/06/illinois-enacts-first-ever-fantasy-sports-regulatory-framework · Virginia HB 145 [M]: https://news.bloombergtax.com/daily-tax-report-state/virginia-enacts-law-imposing-10-percent-tax-on-fantasy-contests · Kentucky HB 904 [L]: https://www.legalsportsreport.com/260498/bill-raising-kentucky-sports-betting-age-vetoed-over-emergency-clause
- Michigan R 432.523 [M]: https://www.law.cornell.edu/regulations/michigan/Mich-Admin-Code-R-432-523 · Tennessee reserve [H]: https://www.law.cornell.edu/regulations/tennessee/Tenn-Comp-R-Regs-1350-05-.08 · Massachusetts caps [M]: https://www.legalsportsreport.com/9272/massachusetts-fantasy-sports-regulations/ · Montana [H]: https://mca.legmt.gov/bills/mca/title_0230/chapter_0050/part_0080/section_0020/0230-0050-0080-0020.html
- California AG opinion [H]: https://www.espn.com/sports-betting/story/_/id/45661944/california-attorney-general-says-daily-fantasy-illegal-state · Washington [M]: https://www.perkinscoie.com/en/news-insights/no-game-changer-for-fantasy-sports-in-washington.html · Florida [M]: https://thecapitolist.com/draftkings-yet-to-receive-cease-and-desist-amid-fgccs-uneven-fantasy-sports-regulation/
- Free-contest law basics [M]: https://olshanlaw.com/sweepstakes-law-basics

**Payments and hosting**
- Stripe prohibited list [H]: https://stripe.com/legal/restricted-businesses · pricing [H]: https://stripe.com/pricing · Connect [H]: https://stripe.com/connect/pricing
- PayPal AUP [M]: https://www.paypal.com/us/legalhub/paypal/acceptableuse-full · Square [M]: https://squareup.com/au/en/townsquare/square-keeps-businesses-safe · Paysafe 20-F [M]: https://www.sec.gov/Archives/edgar/data/1833835/000119312526088095/psfe-20251231.htm · Aeropay costs [M]: https://www.aeropay.com/blog/pay-by-bank-merchant-cost-comparison
- Mastercard fees (secondary) [M]: https://pulsecrm.com/blog/mastercard-specialty-merchant-registration-fees-2026/ · Persona [M]: https://help.withpersona.com/articles/1XNnqukfZY9VamF2e7jkuJ/ · FinCEN [M]: https://www.fincen.gov/system/files/shared/FIN-2014-R012.pdf · 1099 forms [M]: https://track1099.com/info/pricing
- Vercel terms [H]: https://vercel.com/legal/terms · Supabase AUP [H]: https://supabase.com/aup

**Analogs**
- DK roster/cap [H]: https://www.thefantasyfootballers.com/dfs/dfs-101-beginners-guide-draftkings/ · DK 2026 prices [M]: https://www.stokastic.com/articles/nfl-dfs/draftkings-week-1-nfl-dfs-pricing-2026 · DK entry limits [M]: https://z3n-sq-gaming.zendesk.com/hc/en-us/articles/18427811259671-Is-there-a-limit-to-the-number-of-entries-I-can-submit-US · DK contest types/overlay [M]: https://dknetwork.draftkings.com/2025/08/29/which-draftkings-nfl-dfs-contest-is-right-for-you/
- Yahoo guaranteed prizes [H]: https://legal.yahoo.com/us/en/yahoo/terms/rules/dailyfantasyfootball · FanDuel [M]: https://www.fanduel.com/research/fantasy-football-strategy · FFPC [M]: https://www.footballguys.com/article/fpc-official-rules
- Splash rake/states/ages/funds [M]: https://intercom.help/splashsports-helpcenter/en/articles/11328687-understanding-the-rake-fee-with-commissioner-rewards · https://legal.splashsports.com/legal/splash-sports-house-rules · https://intercom.help/splashsports-helpcenter/en/articles/14625505-deposits-payment-issues-and-unrecognized-charges
- LeagueSafe [M]: https://help.leaguesafe.com/hc/en-us/articles/217117406-What-are-the-fees-on-LeagueSafe · ESPN Pick'em [M]: https://fantasy.espn.com/games/nfl-pickem-2026/picks · Sports Geek [M]: https://www.thesportsgeek.com/contests/beat-the-geek/ · Affiliates [M]: https://www.bettingusa.com/affiliate/ · CPA [L]: https://track360.io/blog/daily-fantasy-sports-operator-affiliate-playbook-2026

**Data and images**
- Sleeper API and Terms [H]: https://docs.sleeper.com/ · https://support.sleeper.com/en/articles/5486620-general-terms-of-use
- nflverse licence, disclaimer, schedule [M/H]: https://github.com/nflverse/nflreadpy · https://github.com/nflverse/nflverse · https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html
- Feeds: SportsDataIO [H]: https://sportsdata.io/help/data-rights-and-licensing-questions · MySportsFeeds [M]: https://www.mysportsfeeds.com/feed-pricing/ · Goalserve [M]: https://www.goalserve.com/en/sport-data-feeds/nfl-api/prices · Sportradar [M]: https://developer.sportradar.com/getting-started/docs/your-account
- Names/stats cases [H]: https://case-law.vlex.com/vid/c-b-c-distrib-894016235 · https://law.justia.com/cases/indiana/supreme-court/2018/18s-cq-134.html · NFLPA group licensing [M]: https://Overthecap.com/collective-bargaining-agreement/article/47/section/4 · NFL marks [M]: https://www.covers.com/industry/nfl-new-sports-betting-deals-fanatics-fanduel-draftkings-sans-prediction-markets-august-2026
- ESPN stat corrections [M]: https://support.espn.com/hc/en-us/articles/360000099732-Stat-Corrections · "Sports pool" (NRS 463.0193) [H]: https://www.leg.state.nv.us/NRS/NRS-463.html

**Repo and measurements:** file:line citations on `08e7b65` [H]; hosted-database reads 2026-11-17 ~19:46Z, independently re-run [H for arithmetic]; PR #528 branch (`spec-duel.md`, `architecture-plan-next-phase.md` §5.1) [H].
