# M6 Task Breakdown — Commissioner Console + Audit, and Stat Corrections (L.E1 remainder + L.E2)

> **Architect session output — 2026-09-29.** Read together with `spec-redraft-leagues.md` **v2.16.76** (the LAW) and `delivery-plan-redraft-leagues.md` **v1.4** (§3 M6 row, `delivery-plan-redraft-leagues.md:71`). This doc sequences the part of M6 that **M6A did not build** into Builder-sized tasks; it never overrides the spec. One task per Builder session, one PR per task, in dependency order (§7). Per the #150 / #161 / #244 / #289 / #323 precedent **this breakdown's PR STAYS OPEN for Chris's approval — the loop builds no M6 task until he merges it and the orchestrator points ACTIVE-BUILD here.**
>
> **Process rule — "lighten it" (Chris, 2026-09-27).** Pre-launch, **full rigour** (adversarial review until clean, pgTAP per role, break probes shown) only for **scoring, standings/results, permissions and production data**. Everything else — API plumbing, UI, copy, tooling, sim, docs — gets **one review pass**; nits become follow-ups; ledger notes stay short. Every task below is tagged **FULL** or **ONE PASS**.
>
> **Task ids.** M6A used `L.E1.1`–`L.E1.27`. M6 continues **`L.E1.28+`** (console, audit, the backstop proof, the gate) and starts **`L.E2.1+`** (the stat-corrections pipeline and its view).
>
> **Seven product questions (§11, to be filed as PROGRESS §3 Q81–Q87 at merge — numbers measured then) block specific tasks only.** Ten of the sixteen tasks need no answer at all; L.E2.1, L.E1.29 and L.E2.5's recorder route can start the day this merges (§7).

>
> **APPROVED 2026-09-29 by Chris ("Approve and start"), with these rulings — they override §11's recommendations where they differ:**
> - **Q81 — RULED: no.** *"Q81 should not be a commish decision. if the stat window has closed I think we have to forget it because if our platform is scoring differently from the others that could be a problem."* After the correction window closes, a late stat fix never changes league scores and there is **no** commissioner apply button; it only updates the player's real stats (research). The league corrections view lists only corrections that changed a league score. L.E2.2 / L.E2.4 drop every "would-be" number and the commissioner door.
> - **Q82 — already ruled (E43):** a game postponed out of the week (indefinitely or rescheduled) → its players score 0, locks release, the week finalizes without it; a game moved within the week → the week is not final until it ends, and fixes count until then. No new ruling; L.E1.28 folds the sentence.
> - **Q83 — RULED: drop.** *"this is not a thing."* **L.E1.35 is DROPPED** (no report flow; the commissioner's existing lineup / score / result tools are the remedy). L.E1.31 no longer waits on it; L.E1.36's E2E drops its report leg; the gate's criterion 1 drops "the illegal-lineup flow"; L.E1.28 strikes §10.2's flag/report steps from the spec (the commissioner remedies stay). F272 closes as not built.
> - **Q84 — as recommended** (feed: trades that go through / are vetoed / are reversed, one line each; offers stay between the two teams). **Q85 — as recommended** (no Undo in M6). **Q86 — as recommended** (one stat-fix rule for every league; the settings page states it). **Q87 — a design choice, not a ruling** (the console as a "needs you now" launchpad + one button per tool).

---

## 1. Scope & exit criteria

**In M6 (delivery plan §3 M6 row; spec §10, §12.12, §12.21, §13.4, §15.4, §16.1–16.2, §16.5.2, §18 Phase E, §23.4):**
- **L.E2 — stat corrections.** Detect a provider's change to a finished game's stat line and record it (`stat_correction_events`, §12.21); a week that is still open re-scores through the existing worker (F405 / 158's rules); a **final week never changes**, but the correction is recorded and `player_stats` stays right for research; each league gets a record of what the correction did to it, a system note, and a **league corrections view** in plain words — *"Week 3: Player X's receiving yards corrected 97 → 95 — your score 101.2 → 101.0."*
- **The commissioner console** (`/app/leagues/[id]/commish`, §10.1 / §16.1): one place that reaches every commissioner tool already built (M6A's verbs, override mode, M5's trade and FAAB tools, settings, schedule, bracket, members, autopilot, the log), in the new design language, **simpler, not denser**.
- **The audit views:** the full commissioner log and League Home activity **completeness** (F463, F371, F233(d)) — every commissioner action, every receipt type, in words, with "show older".
- **Audit completeness:** a receipt for every commissioner action that still writes none (F40 draft controls, F32 membership, league setup), so the proof below is true of the whole app, not of §15.4 alone.
- **The §10.2 illegal-lineup flow** (report → remedy → applied, logged, announced) — named by §18's Phase E gate.
- **Proofs:** the backstop proof test (no override path mutates state without a log row), a recorded **real 2026** correction replayed into a changed result with a system note, and **`test:gate:m6`** composing `test:gate:m5` (→ m4 → … → m0).

**Not in M6 (named so nobody builds them by accident):**
- **The platform operator console** (M8, `delivery-plan-redraft-leagues.md:74`) — pausing jobs, forcing a week close, cancelled games (Q37 / F243), Q50(d)'s notice.
- **Undo from the log** (§10.4) — **Q85** asks; recommended out of M6.
- **A per-league stat-correction deadline** (§7.3.6's 0h–7d) — **Q86** asks; recommended out of M6.
- **Redo a draft after it finished** (F44) — a rare, destructive power (rosters, schedule and every scored week go). Not scheduled; it becomes a task the day Chris asks for it. **F45** (start a draft with empty seats) is already reachable — placeholder seats autopick (D93) — and gets its receipt in L.E1.29.
- **The commissioner read of every draft queue** (F48) — nothing in the console consumes it; it stays open for an autopick-debugging surface.
- **Access gated on manager stints** (F35) — the console gates on `league_members` like every verb; F35 stays open.
- Push notifications / digests (§16.4) — M6 writes in-app `notifications` rows only; Ultra / charted re-scoring (E57, F381's other sentences) — unfunded.

**Exit criteria (delivery plan §3 M6 row + spec §18 Phase E, restated as checkable; the reason clause re-read under Q66 — a reason is optional):**
1. **Phase E gate:** every commissioner action writes one immutable, member-readable log row with a correct before / after (reason optional); a no-op writes none; changing a matchup result **from the illegal-lineup flow** works and is visible to every member; log rows cannot be edited or deleted by anyone.
2. **Backstop proof test:** no override path can mutate state without a log row — proven by a catalog census (every commissioner-gated writer), a behavioural matrix (one row per change, none per no-op), and the database triggers refusing an owner-role write that bypasses the verbs.
3. **Real correction replay:** a recorded **real 2026** provider correction replays into a changed matchup result with the system note, the managers' notifications and the corrections-view row; the same correction after the week is final changes nothing but `player_stats` and is listed.
4. **Continuity:** `test:gate:m5` (which composes m4 → m0) stays green.

---

## 2. Current state (measured 2026-09-29 on `main` @ `d331d27`; migrations 001–166, pgTAP 001–114; production at **166**, push debt none)

### 2.1 What M6 builds on
- **The audit spine** (M6A): `commissioner_actions` (`123:275`) + `log_commissioner_action_internal` (`123:417-453`, sets `app.commish_action_id`), the immutability backstop (`123:339-410`, TRUNCATE closed by 133), the seven-part verb template **D336**, reason optional everywhere (Q66, 131), the `matchups` override backstop (126, D343's predicate). **21 functions call the helper directly**; every §15.4 verb and every M5 commissioner arm (claims, trades, votes, FAAB, ~~`set_lineup`'s arm~~) reaches it (measured transitively over the chain heads). *[Corrected 2026-09-29 (L.E1.29 review, R1323): `set_lineup`'s commissioner arm does NOT reach it — measured over 001–168, `set_lineup_internal`'s newest definer (157:404) calls no receipt helper (131 made its reason optional, nothing more). Carried by PROGRESS **F514**, owned by **L.E1.30**.]*
- **The routes:** `src/app/api/leagues/[id]/commish/` has `autopilot`, `bracket`, `faab`, `lineup`, `log`, `matchup-lock`, `move-player`, `result`, `roster`, `schedule`, `score`, `setting`, `team`, `trade`; `GET /api/leagues/[id]/activity` exists.
- **The controls live on their surfaces** (M6A's ruling-(h) shape): override mode (`override-mode-bar.tsx`, `commish-override-store.ts`) on the team page, matchup page, settings panel and trade center; `team-commish-tools.tsx` (move / force add-drop / rename / FAAB / autopilot); `matchup-override-panel.tsx` (score / result, with the Q61/Q67 "not finished yet" sentence); `bracket-hand-pick-panel.tsx`; `schedule-view.tsx` + `schedule-remix-modal.tsx`; members, roles and remove-manager in `invite-panel.tsx`.
- **Scoring (M4/M5):** ingestion `ingestWeek` (`src/lib/sync/ingest-week.ts` — `diffStats` splits inserts / updates / `metaOnly`; `player_stats` updated **in place**); the hourly sweep re-polls every earlier week still inside its window (`weeksInCorrectionWindow`, `live-poll.ts` — F270 closed); the worker `score-week-worker.ts` → door `score_write_week_batch` (head **158**) writes each starter's points with the team score (`league_week_player_points`) and refuses a `final` week; the window ends at the next week's first kickoff and a final week's rows are locked (158, D422); `finalize_matchups` (head 118) holds a week on `games_not_final` / `pending_scores`.
- **The feed:** `activity-service.ts` (transactions + system posts), `activity-feed-ops.ts` (receipt copy), League Home reads the newest **8** log rows (`COMMISH_LOG_HOME_LIMIT`, `league-home-season.tsx:709`); `readCommishLog` already pages by cursor (`commish-log-service.ts:151`).

### 2.2 What does not exist
- **No `stat_correction_events`** (grep over `supabase/migrations/*.sql`: 0 hits). A corrected line overwrites the old one, so nothing can say what a correction changed (F268's open half). A **final** week is never re-polled, so a correction that lands after the lock is not even seen.
- **No page** at `/app/leagues/[id]/commish` or `/app/leagues/[id]/activity` (the app's league routes are `draft`, `matchup`, `players`, `schedule`, `settings`, `standings`, `team`, `trades`).
- **No report verb** for an illegal lineup (F272) and no guided remedy (§10.2).
- **Unknown receipt types fall back to code words** — `activity-feed-ops.ts` ends `return item.action_type.replace(/_/g, ' ')`, and a setting change prints its key (`waiver_run_days` → "waiver run days").

### 2.3 The receipt gap, measured
Commissioner-gated functions that write league state and reach **no** receipt (chain heads, measured with a transitive scan of 001–166 — the Builder re-measures):
- **Draft room (F40):** `draft_pause` / `draft_resume` (095), `draft_undo`, `draft_reassign_pick`, `draft_move_player`, `draft_force_pick`, `draft_set_order`, `draft_reverse_won_bid`, `draft_adjust_budget`, `draft_cancel_nomination`, `draft_end` (100), `draft_set_clock` (101), `draft_reset` (150), `draft_start_internal` (110), `draft_create_internal` (066), `set_team_autodraft` (072).
- **Membership (F32):** `add_placeholder_seat`, `assign_manager`, `set_member_role` (063), `remove_manager` (150); invites `create_league_invite`, `revoke_league_invite`, `rotate_invite_code`, `set_league_invite_slug` (062).
- **League setup:** `update_league_settings` (118), `update_league_profile` (064), `set_league_status` (059), `soft_delete_league` (060), `scoring_update_rules` / `scoring_fork_template` (105).
Each posts to `league_chat` or nothing; none leaves an audit row. Until they do, exit criterion 2 is true only of §15.4.

---

## 3. Design decisions (Architect; **TD1–TD16** — they enter PROGRESS §4 as D-numbers at merge, measured then)

- **TD1 — Two lanes, ONE schema lane.** L.E2 (ingestion, scoring records) and L.E1 (receipts, reports) both write migrations; they serialize in merge order. TS/UI tasks fan out behind their dependencies in separate worktrees; one local database — serialize `db reset` / `test:db`.
- **TD2 — What a correction is.** A change to a **scoring** stat of a player's line **for a game that was already `final` at the previous write**, or a first line for such a game (a provider gap filled late — F269(a)). A `metaOnly` rewrite (`is_live` / `game_id` / `source`) is never one (F268). One event per (season, week, player, stat key) change, carrying old and new value and the week's state at detection (`open` / `final`). Events are NFL data, not league data: SELECT for `authenticated` (as `player_stats`, `001:611`); no write policy.
- **TD3 — Events land in the same transaction as the stat line (F267 taken).** A service-role `ingest_write_batch(p_rows, p_now)` door (SECURITY DEFINER, `search_path = ''`, in-body role check, REVOKEd) writes the stat rows, the events and the `score_fanout` enqueue together; `ingestWeek` computes the diff (TS stays the one diff) and calls it. **Deploy-before-push:** while the door is absent (PGRST202, measured), `ingestWeek` keeps today's two-call path and says so in its report — the production poll must never stop scoring.
- **TD4 — Finality governs, not the clock (Q82's recommendation, Q47's (a)).** An open week (live or in its window, including a week held past its window by an unplayed game) re-scores through the ordinary worker, unchanged. A `final` week is never re-scored: the event is recorded, `player_stats` moves (research stays right), 158's lock holds.
- **TD5 — Re-poll reach.** Unchanged for open weeks (F270). New: each **final** week is re-polled **once a day for 7 days after it locks** (a named constant) so a late correction is recorded and research stays right. Nothing it finds changes a score.
- **TD6 — Each league keeps its own record of a correction.** `league_stat_corrections` — one row per (league, week, team, player, event batch): player points before → after, team score before → after, matchup result before → after, `state ∈ applied | week_final`. For an open week the door writes it **in the same transaction as the re-score** (the door already holds the old and new per-player rows — 158). For a final week the worker computes the would-be numbers (pure TS, the same `computeTeamWeek`) and records them with `state = week_final`; no score, result or stored point row moves. Only teams that **started** the player that week get a row (spec §12.21, "filtered to that league's starters"). A correction that moves no points (a stat the league doesn't score) writes no row. SELECT: league members; no write policy.
- **TD7 — Announce once per league per re-score.** One system post in league chat naming each correction and each changed team score; an in-app notification only to a manager whose matchup **result** changed (§16.4's matrix, "stat correction changed a result"). A score-only change is in the post and the view. A `week_final` record posts nothing (nothing changed) — commissioners see it in the view (Q81).
- **TD8 — F245's apply half is the door's.** An in-window re-score writes the matchup `result` with the score in one statement, so `rebuild_team_week_results` never sees `result_drift`; a post-lock change goes only through `commish_edit_score` (126, already F245-safe). F476: a re-score of the last regular-season week (or a playoff round) runs the bracket sync at once, not at the next hourly beat.
- **TD9 — Every commissioner write gets a receipt.** The §2.3 functions gain the D336 receipt on their commissioner arm: one row per change, none per no-op, mocks excluded (a mock has no commissioner, §8.8). A receipt carries nothing the members' read must not see — **never an invite token, an invitee's email, a blind bid or a queue** (the log is member-readable, §10.3).
- **TD10 — The backstop is proven three ways.** (i) A pgTAP **catalog census** over `pg_proc`: every function that checks `is_league_commish` (or a commissioner arm) and writes a league table reaches the helper, or sits on a named allowlist with its reason — a new unreceipted commissioner writer reds by name. (ii) A table-driven behavioural matrix over every verb: change ⇒ exactly one row; no-op ⇒ none. (iii) Triggers: every column that points at the log (`matchups.override_action_id`, `matchups.pairing_set_by_action_id` (134), `transactions.related_action_id`, `league_weeks.reopened_by_action_id`, `league_weeks.scoring_rules_action_id` (144)) may only be set to the id held in `app.commish_action_id` — the D343 shape, `ENABLE ALWAYS`. The Builder measures every writer of each column first: a column a job also writes (e.g. 144's week-open copy) is guarded to the value that job copies, or stays off the list with its reason in the census.
- **TD11 — The console is a launchpad, not a second copy of the tools (Q87's recommendation).** Every control stays where M6A and M5 put it. The console shows **what needs the commissioner now** and **one door per tool group**, each landing on the right screen with override mode on. No new shared component; `OverrideModeBar` and the activity renderer are reused.
- **TD12 — One activity renderer, no code words.** League Home, the Activity page and the console's recent list render through `activity-feed-ops.ts`; a census test fails if any `action_type` in §12.12's vocabulary (or any setting key) has no plain-words copy — the `replace(/_/g, ' ')` fallback retires.
- **TD13 — The illegal-lineup flow composes existing verbs.** The only new state is the report. Remedies: **zero out a player** = `commish_edit_score` to the stored team score minus his stored points (158 makes it exact); **set the result** = `commish_set_result`; **start the right player** = `commish_edit_lineup` + `commish_edit_score` to the recomputed total; **adjust by hand** = `commish_edit_score`. Each receipt carries the report id; the report points at its receipt. The Q61/Q67 rule binds every remedy (a matchup still being played can't be corrected — the flow says so and offers nothing).
- **TD14 — Prevent, don't refuse (Chris 2026-09-29).** No console, report, correction or log control is offered that the server would refuse; when an action isn't possible yet, the reason is shown in words. Server checks stay as the backstop.
- **TD15 — Deploy before push.** Merged code reaches fieldscout.gg at once; the database moves only when Chris pushes. Every M6 read and write degrades on a database without its migration (read by GET, never HEAD — R1257; PGRST202 / PGRST205 / 42P01 named), and each PR says how.
- **TD16 — Act-as-Manager is already delivered** by override mode (standing rule (h)) plus the commissioner arm on every manager verb (M5 TD5). M6 **proves** it (L.E1.31's manager-verb census) rather than building a second mechanism; the log renders `acting_as_team_id` as "for <team>".

---

## 4. Standing rules for every M6 task

1. **Spec first.** Every ruling or erratum folds into the spec changelog in the same PR. The spec wins; ambiguity → STOP, file it in plain terms (PROGRESS §3).
2. **Server-authoritative.** Clients never compute a score, a correction's effect, a result or a remedy. `SECURITY DEFINER SET search_path = ''`, auth re-checked in-body, the league row locked before validation, `action_id` idempotency on every client-triggered mutation.
3. **Time only through `p_at` / `p_now`**; stats only through the `StatsProvider`. No `Date.now()` or `fetch` in `src/lib/leagues/**`.
4. **CREATE OR REPLACE against the HEAD of the chain** (`grep -n "FUNCTION <name>" supabase/migrations/*.sql | tail -1`, then the file text — never the deployed body; D137 hunk discipline).
5. **Never weaken:** §12.12 immutability, the §7.3.4 / §11.2 locks, 158's final-week lock, scoring-snapshot / per-week-rules reads (144).
6. **Loud, never "nothing happened".** A poll that finds no correction says why; a re-score that changes nothing writes no record and says so; every read of a large set pages past 1000 rows.
7. **Receipts follow D336** — one row inside the no-op guard, a system post, triple-REVOKEd internals; a no-op writes nothing (standing rule (b)).
8. **FULL tasks** add pgTAP per role (anon / non-member / member / commissioner / owner), a break probe shown red then green, and a re-review until clean. **ONE PASS** tasks: one review, nits filed.
9. **Migrations:** `npx supabase migration new`, typegen committed (the hand-written alias block kept), `IF NOT EXISTS` guards, RLS + policies in the table's own file; production only via `db push` (Chris's). The PR states how merged code behaves on a database at 166 (TD15).
10. **Design:** new design language, single theme, tokens only, elevation only on hover or true overlays; extend `src/components/ui/` variants — no new shared component without approval. Plain fantasy words on every screen: no stat keys, action types or setting keys.

---

## 5. Interface sketches (names contractual; the Builder finalizes fields)

**Tables (new):**
- `stat_correction_events` — §12.21 as printed **plus** `game_id`, `week_state TEXT CHECK (IN ('open','final'))`, `source`, a natural-key UNIQUE (season, week, player_id, stat_key, detected_at) so a replayed batch cannot double-record; `applied_at` stamped when no league still has an undrained re-score for it. SELECT `authenticated`; no write policy.
- `league_stat_corrections` — TD6's rows: `league_id`, `season`, `week`, `team_id`, `player_id`, `event_ids UUID[]`, `player_points_before/after`, `team_score_before/after`, `result_before/after`, `state`, `recorded_at`. SELECT `is_league_member`; no write policy; broadcast on INSERT (member-visible columns).
- `lineup_reports` — `league_id`, `season`, `week`, `matchup_id`, `reported_team_id`, `player_id` (nullable), `rule_text` (≤ 500), `reported_by`, `status ∈ open | resolved | dismissed`, `resolution_action_id` → `commissioner_actions`, `action_id` UNIQUE per league. SELECT per Q83; no write policy.

**RPCs:** `ingest_write_batch(p_rows, p_now)` (service role) · the door's `corrections` element on `score_write_week_batch` · `stat_correction_record_final_week(p_league, p_rows, p_now)` (service role — TD6's `week_final` rows) · `report_lineup(league, matchup, team, player?, rule_text?, action_id)` (any member) · `resolve_lineup_report(report, remedy, args, action_id)` (commissioner; dispatches to the existing verbs) · receipts on the §2.3 functions (no signature change beyond an optional `p_reason` where missing).

**Routes:** `GET /api/leagues/[id]/corrections?week=` · `GET /api/leagues/[id]/commish/summary` (the console's "needs you" read) · `GET /api/leagues/[id]/commish/log` gains `type` / `team_id` / `week` filters · `POST /api/leagues/[id]/commish/flag-illegal` (§15.4's printed route — the resolve) · `POST|GET /api/leagues/[id]/reports` (member report / own reports). Error mapping per the in-season family (`inseason-errors.ts`).

**Hooks:** `useStatCorrections`, `useCommishSummary`, `useCommishLog` (filters + `fetchNextPage`), `useReportLineup`, `useResolveReport` — one hook per file, React Query.

---

## 6. Task list

### L.E1.28 — Spec fold-back of the M6 rulings + ledger transcription (DOCS ONLY) · ONE PASS
- **Blocked by:** the Q81–Q87 answers (fold whichever are ruled; re-run for late ones). **Depends:** this breakdown merged.
- **Scope:** fold each ruling with a changelog entry — §23.4 (post-lock correction per Q81, held week per Q82), §10.2 (report visibility, Q83), §13.4 (trade lines, Q84), §10.4 (undo, Q85), §7.3.6 (the deadline setting, Q86), §10.1 / §16.2 (the console's shape, Q87); errata C79–C84 (§10); transcribe TD1–TD16 as D-numbers; close the rows §10 names as already discharged by M6A; answer Q47 with Q82's ruling.
- **Acceptance:** every ruled Q marked ✅ with Chris's words verbatim; no spec sentence contradicts a ruling; version bumped.

### L.E2.1 — Migration: `stat_correction_events` + the one-transaction ingest door (F267) + detection + the final-week re-poll · **FULL** (scoring inputs, the production poll)
- **Blocked by:** nothing. **Depends:** this breakdown merged.
- **Scope:** the table (§5); `ingest_write_batch` (TD3); `ingestWeek` classifies each update / insert per TD2 against the stored game state **before** this poll and sends the events with the rows; the old two-call path kept only as the pre-push fallback, named in the report; `live-poll.ts` adds TD5's daily re-poll of final weeks (a final week's delta may still enqueue; the door refuses `week_final` by name as today, and L.E2.2's worker records it instead of retrying).
- **Acceptance:** a scoring change to a final game's line writes exactly one event per moved key in the same transaction as the line; a live game's updates write none; a `metaOnly` rewrite writes none; a replayed batch writes none twice; a correction to a final week is recorded and `player_stats` moves while every league cell stays byte-identical.
- **Proofs:** pgTAP — the door per role (service role only; anon / authenticated refused), the natural key, the transaction (a failing enqueue rolls the line and the events back); stack — the pre-push fallback against a database without the door (PGRST202 measured); `ingest-week.test.ts` table for the classification (live → final → corrected → corrected again; gap filled late; metaOnly); break probe: classify against the NEW game state ⇒ the live-game cell reds.

### L.E2.2 — Migration: each league's correction record, the announcement, F245's apply half, the bracket re-sync · **FULL** (scores, results, standings)
- **Blocked by:** Q81 for the `week_final` would-be numbers' audience only (the rows are written either way). **Depends:** L.E2.1.
- **Scope:** `league_stat_corrections` (§5); `score_write_week_batch` replaced against 158's file text — an optional `corrections` element; the door writes TD6's `applied` rows in the same transaction as the re-score, derives `result` with the score (TD8), then the system post and result-flip notifications (TD7); the worker sends the element when the drained players carry unapplied events, and for a final week calls `stat_correction_record_final_week` with pure-TS would-be numbers; `applied_at` stamped; F476's immediate bracket sync; `reconcile.ts` names the event behind a final week's moved line (F268's last half).
- **Acceptance:** an in-window correction to a started player re-scores, writes one record per affected team, one system post per league, and a notification only where a result changed; a benched player's correction writes no record; a final week gets `week_final` records and nothing else moves; a correction that moves no points writes nothing and says why.
- **Proofs:** pgTAP — the door's new element per role, result-with-score (no `result_drift`), the final-week refusal unchanged, member-only SELECT on the records (non-member sees none); stack — worker → door end to end on a correction that flips a result (median and second-opponent included — the F373 knock-on is a correction, not an override, so D345 is untouched and the task says so); break probes: write the record outside the re-score transaction ⇒ the rollback cell reds; drop the starter filter ⇒ the bench cell reds.

### L.E2.3 — API + hooks: the corrections read + correction items in the feed · ONE PASS
- **Depends:** L.E2.2.
- **Scope:** `GET …/corrections?week=` (members; per week, per correction: player, stat in words, old → new, team, points before → after, result change, `applied` / `week final — scores unchanged`), paged; `activity-service.ts` includes the correction system posts; `useStatCorrections`. Degrades before the push (TD15).
- **Proofs:** `corrections-api-db.test.ts` incl. non-member 404, a week with none (says so), the pre-push shape.

### L.E2.4 — UI: the corrections view, the matchup change note, the box score's stored-points note (F477), the settings label (F475) · ONE PASS
- **Blocked by:** Q81 (the commissioner's door on a final week), Q86 (the settings label). **Depends:** L.E2.3.
- **Scope:** `corrections-view.tsx` as the Activity page's "Stat corrections" tab (L.E1.34 hosts it — build the view here, mount it there or on its own tab if L.E1.34 is not yet merged); the matchup page's note when a correction changed the score or result; the box score renders `points_source` / `stored_note` in words (F477); per Q81, the commissioner's door on a `week_final` row; per Q86, the settings panel's deadline label. States: empty week, loading, error, pre-push, `week_final`.
- **Proofs:** render tests per state; ops tests for the copy ("receiving yards" not `rec_yd`).

### L.E2.5 — Capture a real 2026 correction as a replay fixture · ONE PASS (script + fixture; no product code)
- **Depends:** L.E2.1 **pushed to production** (for the production-detected route) — or nothing (for the recorder route).
- **Scope:** `scripts/record-fixtures.ts` gains a two-snapshot mode: the week's lines at the week's last final game and again at its window's end, written as `fixtures/nfl/2026/wkNN/` (the 2025 wk02 shape, gzip JSONL); a small diff tool that names every final-game change between the two snapshots. First route to a hit wins: the production events after L.E2.1's push (read-only export — no production write), or the recorder run from week 4 on.
- **Acceptance:** a committed fixture pair holding at least one real scoring correction, the diff naming it (player, key, old → new, game). **If a week passes with none, say so on the record and run the next week — never fabricate one.** (The data is public NFL stats; the repo is public — nothing else goes in the fixture.)

### L.E2.6 — The replay proof + the synthetic scenarios learn about corrections · **FULL** (the milestone's scoring proof)
- **Depends:** L.E2.2, L.E2.5.
- **Scope:** a stack test that seeds a league **built around the corrected player** — his team starts him, the opponent's score set so the real delta flips the result (said plainly in the test: the correction is real, the league is constructed) — replays snapshot 1 (scored, window open), then snapshot 2 through the real `ingestWeek` → worker → door → finalize; the same replay again after the week is final. The M4 `correction_in_window` / `correction_post_window` scenarios assert events, records and posts, and zero final-cell moves.
- **Acceptance / proofs:** in-window — one event, the result flipped, one system post naming the player and both scores, the losing-now manager notified, the view row; after the lock — the event, `player_stats` moved, a `week_final` record, every league cell and stored point row byte-identical; each assertion's population > 0; break probe: skip the correction element ⇒ the view-row cell reds while the score cell stays green.

### L.E1.29 — Migration: receipts for the draft-room controls (F40, F45) · **FULL** (permissions, audit)
- **Blocked by:** nothing. **Depends:** this breakdown merged.
- **Scope:** every §2.3 draft function replaced against its head (D137, the receipt hunk only): one `commissioner_actions` row per real change with before / after (the pick, the price, the clock, the order, the budget), none for a no-op, none for a mock draft; the existing `league_chat` posts unchanged; `action_type` vocabulary extended in §12.12's comment (`draft_pause`, `draft_undo`, …, `draft_start`, `set_autodraft`). A start with placeholder seats records them (F45).
- **Proofs:** pgTAP — per function: change ⇒ one row, no-op ⇒ none, mock ⇒ none, manager refused (42501 unchanged); held-lock time on `draft_undo` and `draft_force_pick` re-measured (< 50 ms, §8.3); the M2/M3 suites green unmodified except where they pinned "no audit row" (named).

### L.E1.30 — Migration: receipts for membership, invites and league setup (F32) · **FULL** (permissions, audit, privacy)
- **Blocked by:** nothing. **Depends:** L.E1.29 (schema lane order only).
- **Scope:** the §2.3 membership, invite and setup functions gain their receipt (TD9's privacy rule — an invite receipt says "an invite for Team 4", never a token or an email); `remove_manager`'s three outcomes, role changes and placeholder seats named; `update_league_settings` / scoring edits before the draft recorded per changed key (a save that changes nothing writes nothing).
- **Proofs:** pgTAP — per function change / no-op; the privacy negative (no receipt's `before` / `after` / `metadata` contains the invite token, `invited_email` or `invited_username` — asserted by value over every row written); member read of the new rows.

### L.E1.31 — The backstop proof: the census, the `*_action_id` guards, the manager-verb census · **FULL** (the proof test)
- **Depends:** L.E1.29, L.E1.30 (and L.E1.35 once it lands — its verbs join the matrix).
- **Scope:** TD10 (i)–(iii) in one pgTAP file + one migration for the column guards; TD16's census: every manager verb (`set_lineup`, `roster_add_drop`, claims, trades, votes, `rename_own_team`, autodraft) accepts a commissioner on any team and writes `acting_as_team_id` — a manager verb that refuses him reds by name (standing rule (a)).
- **Acceptance:** the census lists every commissioner-gated writer with its verdict; the allowlist is short and each entry says why; a direct owner-role `UPDATE` of any guarded column outside a verb is refused by name.
- **Proofs:** break probes — add a throwaway commissioner-gated writer without a receipt ⇒ the census reds naming it; drop one verb's helper call ⇒ the matrix reds; disable one column guard ⇒ its cell reds.

### L.E1.32 — API + hooks: the console's "needs you" read + log filters · ONE PASS
- **Depends:** L.E1.29 (so the log has draft rows to filter).
- **Scope:** `GET …/commish/summary` (commissioners only): teams with no manager and autopilot off; trades waiting on the commissioner's review; open lineup reports (after L.E1.35); `week_final` corrections this week (after L.E2.2); matchups whose score can be corrected now vs not yet (the Q61/Q67 read already built); nothing invented where a read does not exist. `GET …/commish/log` gains `type` / `team_id` / `week`; `useCommishLog` pages with `fetchNextPage`.
- **Proofs:** route tests incl. a manager's 403, an empty league, the pre-push shape of each optional section.

### L.E1.33 — UI: the Commissioner Console page · ONE PASS
- **Blocked by:** Q87. **Depends:** L.E1.32.
- **Scope:** `/app/leagues/[leagueId]/commish` (commissioners only; a "Commissioner" door in the league nav and on League Home for them alone): override mode switch at the top; **Needs you** (L.E1.32's list, each item one tap to the right screen with override mode on); **Tools** in plain groups — *Lineups & rosters* (team pages), *Scores & results* (matchups), *Trades & waivers* (trade center, FAAB), *Schedule & playoffs*, *League settings*, *Members & autopilot* — each a door, not a copy of the control (TD11); **Recent actions** (the last five, "see all" → the log). States: pre-draft (the draft tools and members lead), in season, playoffs, complete, empty "nothing needs you", loading, error. Confirmations with before / after on reverse trade, reset draft and set result, where a surface lacks one (§10.4).
- **Proofs:** render tests per state; a manager gets the league page, not the console.

### L.E1.34 — UI: the Activity page + League Home activity completeness (F463, F371, F233(d)) · ONE PASS
- **Blocked by:** Q84 for the trade lines only. **Depends:** L.E1.32; L.E2.4 for its corrections tab.
- **Scope:** `/app/leagues/[leagueId]/activity` — tabs *All · Adds & drops · Trades · Commissioner · Stat corrections*; the commissioner log filterable by team and week, "show older" on the cursor (F371); every row with the ✸ treatment links to its entry and every ✸ badge on a matchup / roster lands on it (F233(d), §10.3); TD12's copy census (every `action_type` and setting key in words; `acting_as_team_id` → "for <team>"); the executed trade shown once (F463) and the other trade lines per Q84; League Home keeps its short list and gains "See all activity".
- **Proofs:** the copy census test; render tests per tab and state; ops tests for the new receipt copy (draft, membership, setup).

### ~~L.E1.35 — The illegal-lineup report + the guided fix (§10.2, F272)~~ — **DROPPED 2026-09-29 (Q83: Chris, "this is not a thing")** · **FULL** (migration, permissions) — the UI half ONE PASS
- **Blocked by:** Q83. **Depends:** L.E1.30 (schema lane), L.E1.32.
- **Scope:** `lineup_reports` + `report_lineup` (any member, own league, a matchup of a started week) + `resolve_lineup_report` (TD13's four remedies through the existing verbs, one receipt per verb, the report resolved in the same transaction; a dismissal per Q83); `/commish/flag-illegal` + `/reports`; the ⚑ *Report lineup* door on the matchup scoreboard for members; the commissioner's guided fix (flag → remedy picker with the before / after score → apply) opened from the report, the console's "needs you", or ⚑ on a matchup directly; the reporter's pending / resolved chip.
- **Acceptance:** a member reports; the commissioner sets the result from the flow; every member sees the new result, the ✸ badge and the log entry; the reporter is told.
- **Proofs:** pgTAP — report per role (non-member refused, member allowed, visibility per Q83), each remedy writes exactly its verb's receipt plus the resolution, Q61/Q67 binds the flow (an unfinished matchup: no remedy offered, the server refuses by name), replay by `action_id`; render tests for the report, the picker and the chip.

### L.E1.36 — E2E: the console, a report fixed from the flow, a correction in the view · ONE PASS
- **Depends:** L.E1.33, L.E1.34, L.E1.35, L.E2.4.
- **Scope:** Playwright over one drafted league: the commissioner opens the console → a "needs you" item → fixes a lineup in override mode → a second member sees it in League Home activity and the Activity page; a member reports a lineup → the commissioner sets the result from the flow → the member sees the result and the ✸ link; an injected in-window correction (the harness's enumerated jobs) appears in the corrections tab with both scores.

### L.E1.37 — THE M6 GATE (`npm run test:gate:m6`) · ONE PASS (runs FULL-rigour suites)
- **Depends:** everything above.
- **Scope:** `scripts/gate-m6.sh`: fresh `db reset` → full pgTAP (incl. L.E1.31's census) → the M6 vitest set (ingest classification, records, replay, copy census) → the season sim with the correction scenarios and one commissioner override per run (F373's licence unchanged — TD6's records are not overrides) → the M6 E2E → `test:gate:m5`. Record the run in PROGRESS; flip M6's status row; §9's map ticked with evidence.

---

## 7. Dependency order — and what can start now

| Task | Depends on | Blocked by a question? |
|---|---|---|
| L.E1.28 spec fold-back | this breakdown merged | the rulings it folds (Q81–Q87) |
| L.E2.1 events + ingest door | this breakdown merged | — |
| L.E2.2 league records + announce | L.E2.1 | Q81 (who sees the would-be numbers) |
| L.E2.3 corrections API | L.E2.2 | — |
| L.E2.4 corrections UI | L.E2.3 | Q81, Q86 (their controls only) |
| L.E2.5 capture a real correction | L.E2.1 pushed, or nothing (recorder) | — (a real correction must happen) |
| L.E2.6 replay proof + sim | L.E2.2, L.E2.5 | — |
| L.E1.29 draft receipts | this breakdown merged | — |
| L.E1.30 membership / setup receipts | L.E1.29 (lane order) | — |
| L.E1.31 backstop proof | L.E1.29, L.E1.30 (+ L.E1.35) | — |
| L.E1.32 console read + log filters | L.E1.29 | — |
| L.E1.33 console page | L.E1.32 | **Q87** |
| L.E1.34 activity page + completeness | L.E1.32 (L.E2.4 for its tab) | Q84 (trade lines only) |
| ~~L.E1.35 report + guided fix~~ | — | **DROPPED (Q83)** |
| L.E1.36 E2E | L.E1.33, L.E1.34, L.E1.35, L.E2.4 | — |
| L.E1.37 M6 gate | all of the above | — |

**Startable on merge with no answer:** L.E2.1, L.E1.29, then L.E1.30, L.E1.32, L.E2.2 (its `applied` half), L.E2.3, L.E2.5's recorder route, L.E1.34 (minus trade lines) and L.E1.31 once its deps land. Suggested loop order: **L.E2.1 → L.E1.29 → L.E2.2 → L.E1.30 → L.E1.32 → L.E2.3**, then whichever blocked task's question is answered first. **L.E2.1 first** because the real-correction capture (L.E2.5) needs it running in production, and the NFL calendar — not the build — sets how long that takes.

**Deploy safety, per lane.** L.E2.1 changes the production poll: it merges only with the pre-push fallback shown against a 166-shaped database, and Chris pushes it before any later L.E2 migration so the poll is on one path. UI tasks (L.E2.4, L.E1.33–L.E1.35) hide a section whose read is absent rather than erroring; the console never offers a control whose route would 404 on 166. Keep the push backlog short — one push per merged schema task.

---

## 8. Migration / pgTAP numbering

**Measure at build time (D161)** — `ls supabase/migrations | tail -1` and `ls supabase/tests | tail -1` right before `npx supabase migration new`. On `main` today the heads are **166 / 114**, so the next pair is **167 / 115**. This doc reserves **no** numbers. Schema-lane order (merge order wins): L.E2.1 → L.E1.29 → L.E2.2 → L.E1.30 → L.E1.35 → L.E1.31.

---

## 9. Exit criteria → proof map

| Exit criterion (§1) | Proven by |
|---|---|
| 1. Phase E gate (log row per change, none per no-op, immutable, the illegal-lineup flow visible to all) | L.E1.29 / L.E1.30 / L.E1.35 pgTAP; 071 §C (immutability, re-run); L.E1.36 E2E; L.E1.37 |
| 2. No override path mutates state without a log row | L.E1.31 (census + matrix + column guards) + 126's `matchups` backstop, run in L.E1.37 |
| 3. A recorded real 2026 correction replays into a changed result with a system note | L.E2.5 (the fixture) + L.E2.6 (the replay, both sides of the lock) |
| 4. Continuity | L.E1.37 runs `test:gate:m5` last |

---

## 10. Conflict report & ledger dispositions

**Conflicts (spec vs code / spec vs rulings) — each folded by the task named:**

| # | Conflict | Resolution | Task |
|---|---|---|---|
| **C79** | §14's `finalize-matchups` row still prints "default **Thu 06:00 ET**" (spec:1696) vs v2.16.68's next-week-kickoff window | Reword to the next week's first kickoff | L.E1.28 |
| **C80** | §12.21 prints no RLS, no dedupe key, no week state, no league record | §5's shape (TD2, TD6) | L.E2.1 / L.E2.2 |
| **C81** | §23.4 / §16.5.2 promise a "post-window commissioner-apply CTA" vs Q64 ("a final week is never re-scored") and F405's lock | Per **Q81** | L.E1.28 / L.E2.4 |
| **C82** | §16.2's `commish-action-modal` "reason-required" and §16.5.2's "reason required" rows vs Q66 and standing rule (h) (no prompt) | Confirm-with-before/after only, no reason field | L.E1.28 |
| **C83** | §18 Phase E gate "with a required reason" vs Q66 | Gate re-read: audit row required, reason optional | L.E1.28 |
| **C84** | §10.1 / §16.2 "all actions live in the Commissioner Console … tabbed hub" vs standing rule (h) (override mode on the surfaces, as built) | Per **Q87** (TD11) | L.E1.28 / L.E1.33 |

**Ledger rows (PROGRESS §6) — disposition:**
- **Discharged by this milestone:** **F32** (L.E1.30), **F40** (L.E1.29; F341 already closed its schedule half), **F45** (L.E1.29 — reachable via placeholder seats, now receipted), **F245** apply half (L.E2.2, TD8), **F267** (L.E2.1), **F268** `stat_correction_events` half (L.E2.1 / L.E2.2), **F269(a)**'s after-grace gap (L.E2.1 — a late-filled line is a correction), **F272** (L.E1.35), **F233(d)** (L.E1.34), **F371** (L.E1.34), **F463** (L.E1.34 per Q84), **F475** (L.E2.4 per Q86), **F476** (L.E2.2), **F477** (L.E2.4), **F302 / Q47** (L.E1.28 per Q82 — the behaviour is already (a); only the ruling and the spec sentence are owed).
- **Already discharged by M6A — flip at L.E1.28 with the pointer:** **F224(c)** (`commish_edit_lineup`, 123), **F227(d)** (`commish_move_player`, 127), **F257(b)** and **F281(a)** (`commish_edit_bracket`, 134), **F223(a)** (decided no-fold, D350).
- **Stay open, named:** **F35** (no stint-gated access in M6), **F44** (redo a finished draft — §1), **F48** (no consumer), **F265** (the blocked-bracket flag stays with M8 / the next `league_week_advance` replacement; the console shows nothing it cannot read), **F373** (untouched — M6's sim injects one primary-row override as L.E1.14 does; corrections are not overrides), **F381** (Q81 answers its stat-correction sentence; E57's charted re-score stays unfunded), **F479** (Node socket churn — belongs to whoever next touches the stack lane; L.E1.37 records whether the M6 gate hits it, and takes it if it does), **F487** / **F498** (dormant — the re-score door stays retired; nothing in M6 re-grants it), **F293** (a score-column default, not M6's).
- **F405 / F270 / F467 / F489** are closed; M6 builds on them and re-opens none.

---

## 11. Questions for Chris (to be filed as PROGRESS §3 Q81–Q87)

Each names the tasks it blocks; everything else can start without it.

**Q81 — A stat fix comes in after a week is final. Should the commissioner get a one-tap way to apply it? — blocks L.E2.4's commissioner door (and who sees L.E2.2's would-be numbers).**
Your ruling: once a week is final its scores never change; a later fix only updates the player's real stats. Example: Week 3 is final; on Friday the league's stat provider takes 2 receiving yards off Player X. The corrections list will show *"Week 3 was already final — scores didn't change."* The spec also promises the commissioner a way to apply such a fix himself. Options: **(a)** list only — the commissioner can still change the score by hand with "correct score", as today; **(b)** a button on the list, for commissioners only, that opens "correct score" with the fixed score already filled in (101.2 → 101.0) — he confirms, and it is logged and shown in activity like any fix; **(c)** a button that applies the fix to every affected matchup in the league at once. *Recommend (b)* — the week still never changes on its own, and a fix a commissioner chooses to make is one tap instead of arithmetic. Members see the stat change; the "would have been" score is shown to commissioners inside the button.

**Q82 — A week can't be finalized until every game is played. If a game is postponed, do stat fixes that arrive while the week is still waiting count? — blocks nothing to build (this is how it works today); blocks the spec sentence (L.E1.28).**
Example: Monday's game is moved to Thursday. Week 5 normally locks at week 6's first kickoff, but it can't be finalized until the postponed game is played. A stat fix to a Sunday player arrives Wednesday. *Recommend: yes, it counts* — a week locks when it is final, not at the usual deadline, so fixes (and the postponed game's own points) keep counting until then. Only final weeks never change.

**Q83 — When a manager reports another team's lineup as illegal, who sees the report? — blocks L.E1.35.**
Example: a manager thinks Team 4 started a player who was suspended, and taps *Report lineup*. *Recommend:* the report is seen only by **the manager who sent it and the commissioners**. If the commissioner changes anything, the league sees it like every commissioner fix (logged, shown in activity, ✸ on the matchup), and the reporter is told. If he decides nothing needs changing, only the reporter is told — nothing changed, so under your "no receipt if nothing is done" rule nothing is posted to the league.

**Q84 — Should the league's activity feed show trade offers, or only trades that happen? (F463) — blocks L.E1.34's trade lines only.**
Today the feed shows a completed trade twice (fix planned: once), plus vetoes and reversals; offers, turn-downs, counter-offers and expired offers appear only in the two managers' trade center. *Recommend: keep offers between the two teams* — the feed shows trades that go through, are vetoed or are reversed, one line each. In a league-vote league everyone already sees trades under review in the trade center, where the vote happens.

**Q85 — An "Undo" button on the commissioner log? — blocks nothing if ruled as recommended.**
The spec says most commissioner fixes should be undoable from the log. Today a commissioner undoes a fix by making the opposite fix (both show in the log). *Recommend: leave Undo out of M6* and add it after the season if commissioners in the test leagues ask for it. If you want it now, it becomes its own task after L.E1.34.

**Q86 — Should a commissioner be able to change how long stat fixes keep counting? (F475) — blocks L.E2.4's settings label only.**
Today every league uses one rule — fixes count until next week's first kickoff (your F405 ruling). The settings page still shows an old "Thursday 6:00 AM" option that does nothing. *Recommend: one rule for every league this season* — the settings page shows it as plain text ("Stat fixes count until next week's first game"), and a per-league choice comes back later if anyone asks.

**Q87 — What should the commissioner's page be? — blocks L.E1.33.**
Today your tools sit where they're used: override mode on the team and matchup pages, trade tools in the trade center, settings, schedule and playoffs on their own pages. *Recommend:* the commissioner page is **one screen that lists what needs you right now** (a team with no manager and autopilot off, a trade waiting for your review, a lineup report, a stat fix on a final week) **and one button per kind of tool**, each taking you to the right screen with override mode already on — plus your last few actions. The other choice is a page that repeats every tool inside it; it would be longer and each tool would exist twice.
