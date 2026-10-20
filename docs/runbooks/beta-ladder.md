# Runbook — the beta ladder with the 2026 test leagues

> M7 task **L.F2.11** (ONE PASS). Rulings: **Q92 (a)** — the 2026 test leagues count for the M7 live-draft weekend, at whatever number they reach (Chris, 2026-10-02/03); **TD8** (PROGRESS D577) — the ladder reuses the 2026 test-league gate, no new gating mechanism; **TD10** (PROGRESS D579) — how the weekend is recorded with no alerts in 2026; **Q91** — nothing pages a human until launch (spec §24.1 v2.16.100). Source of the rungs: delivery plan v1.7 "Beta ladder (inside M7)". Build decisions: PROGRESS D650–D652.
>
> **The repo is public.** Records written into this repo carry **counts, dates and severities only** — never a league name, a username, an email, an id, an invite link or a hostname.

---

## 1. The gate (TD8 — nothing new is built)

The 2026 cohort is held behind what already exists. There is no per-user allowlist and no cohort flag to flip.

| What | How it works today | Where |
|---|---|---|
| **Leagues are on for the deployment** | `NEXT_PUBLIC_FLAG_LEAGUES=true` on the production Vercel project. Off ⇒ every `/app/leagues` URL and every join link sends the visitor to `/app`. It is one switch for the whole deployment, set at build time. | `src/lib/feature-flags.ts`; `(shell)/leagues/layout.tsx`, `(room)/leagues/layout.tsx`, `join/[token]/page.tsx` |
| **Who is in the cohort** | Whoever a commissioner invites. A league has no public listing; a person joins only with that league's invite link or code. **Inviting someone into a test league is how they join the cohort.** | spec §12.17 / §12.23; migration 055 |
| **Practice drafts** | Their own flag, `NEXT_PUBLIC_FLAG_MOCK_DRAFTS` — independent of leagues (E79). Not part of the ladder. | `featureFlags.mockDrafts` |
| **Per-league feature flags** | Spec §24.2's `leagues.settings.flags` (canary new engine behaviour on staff leagues first) is **not built**. Not needed in 2026: every 2026 league is a test league, so the whole cohort is the canary. Filed as **F760** for the GA canary rung. | spec §24.2 |

A rung therefore changes **how many leagues are invited**, never a flag. Before inviting a new rung, check once that a cohort member who is signed in reaches `/app/leagues` (rather than landing on `/app`); that is the only proof the flag is on — Vercel env values can't be read back.

---

## 2. The rungs (2026)

Each rung runs **at least one real draft and at least two scored weekends** before the next rung is invited (plan v1.7). In 2026 the NFL season is under way, so scored weekends are real ones. A rung's leagues stay on — rungs add leagues, they don't replace them.

| Rung | Leagues | Who | Enter when | Leave when (all recorded, §3) |
|---|---|---|---|---|
| **1 — Staff** | 1 | Chris's own test league | now | ≥1 real draft complete · ≥2 weeks final (open S0/S1 from it is recorded, §3 — Chris weighs it) |
| **2 — Friends & family** | up to 5 (Chris's included) | friends Chris invites | Rung 1 left; Chris says go | the same, across every rung-2 league |
| **3 — The cohort** | whatever number it reaches (Q92 (a)) | further invites | Rung 2 left; Chris says go | the live draft weekend recorded per §4 and **Chris rules on it** |
| *GA canary (2027)* | *25, feature-flagged* | — | *not a 2026 rung — needs F760 and the pre-launch window (TD9)* | — |

"Chris says go" is literal: the ladder never advances on its own, and no builder or orchestrator accepts a rung on his behalf (standing rule (f)).

---

## 3. What to record at each rung

One block per rung, appended to §6 of this file. Counts only (see the banner).

```
### Rung N — <entered YYYY-MM-DD> → <left YYYY-MM-DD or "open">
- Leagues in the rung: <n>   human seats: <n>   placeholder seats: <n>
- Drafts: <n> real complete  (<n> snake / <n> auction)   any not complete: <n + why>
- Scored weeks final across the rung: <n>   weeks re-opened or re-scored: <n + why>
- Operator actions (platform_operator_actions) in the rung: <n by verb>
- Commissioner log rows in the rung: <n by type>, each classed LEAGUE CHOICE or FIX (see §4.3)
- Job pauses opened / still open: <n> / <n>
- F-rows filed from the rung: <F-ids with S0/S1/S2/S3>   open S0/S1 from the rung: <n>
- Feedback themes (auction, custom scoring — the 2026 focus): <one line each, no names>
- Ruling: <Chris's words + date, or "awaiting Chris">
```

The numbers come from the SELECTs in §5, run over the rung's dates.

---

## 4. Recording the live draft weekend (TD10 — exit criterion 4)

Criterion 4 is *"the beta completes a live draft weekend without a page."* There are no pages in 2026 (Q91), so the record says what happened and Chris rules.

### 4.1 The window
Pick the weekend when the rung-3 leagues draft. The window runs **from Friday 00:00 Pacific before the first cohort draft until the draft week's scoring is final** in every cohort league — and it never ends before the **Wednesday 00:00 Pacific** after that week (the §11.2 ceiling). Write the exact start and end in the record.

### 4.2 The evidence (all of it, in the record)
1. **Drafts in the window** — how many started, how many completed, any that ended paused, any that sat past their pick deadline with no tick (a stuck draft).
2. **`platform_operator_actions`** in the window — every row, by verb.
3. **The commissioner log** in the window — `commissioner_actions` plus the per-verb `commish_*_actions` tables, by type.
4. **Admin Home when the window ends** (`/app/admin`, M8 — taken at the end point of §4.1, not before) — stuck weeks (`overdue_weeks`), job pauses, last cron runs — as counts.
5. **Cron failures** in the window — `cron.job_run_details` rows with status `failed`. *Caveat:* the `*-ping` jobs call the app over HTTP; a ping that ran but whose call failed shows as `succeeded` here. Check the app's logs for those routes over the window as well and say so in the record.
6. **Every F-row filed** from anything seen in the window, with its TD6 severity (S0 = wrong score / standing / result, data loss or a permission breach; S1 = a draft or scoring weekend could not finish without operator help).

### 4.3 How a row is classed
Every row from 4.2 items 2 and 3 is classed **FIX** (someone acted because the system got something wrong — a stuck draft restarted, a week re-scored for our bug, a job paused because it misbehaved) or **LEAGUE CHOICE** (a commissioner doing the league's business — a lineup set for an absent manager, a setting changed). Items 4 and 5 are classed too: **every cron failure, every job pause and every stuck week is a FIX** unless the record says why it is not (e.g. a pause Chris opened on purpose for a reason outside the system) — even when no person acted on it. Write one line per FIX saying what the fault was. When unsure, write it down as unsure and let Chris class it — never resolve it in favour of "without a page".

### 4.4 The statement
The record ends with exactly one of:
- *"No operator or commissioner action was needed to fix a system fault during the window; zero S0/S1 F-rows were filed from it."* — with the evidence above; or
- *"Fixes were needed:"* followed by each FIX and its F-row.

Then: **"Ruling: awaiting Chris."** Chris's ruling is copied in verbatim with its date when he gives it. Criterion 4 is met only by that ruling. L.F2.12 (the M7 gate) attaches this record.

---

## 5. The SELECTs (read-only)

Run against production through the Supabase MCP or the dashboard SQL editor as read-only SELECTs. Replace the two timestamps. Output is counts; nothing here names a person or a league.

```sql
-- window: set once
WITH w AS (SELECT timestamptz '2026-01-01 08:00+00' AS s, timestamptz '2026-01-01 08:00+00' AS e)
SELECT
  (SELECT count(*) FROM leagues WHERE deleted_at IS NULL)                                   AS leagues_live,
  (SELECT count(*) FROM league_members m JOIN leagues l ON l.id = m.league_id
      WHERE l.deleted_at IS NULL AND NOT m.is_placeholder)                                  AS human_seats,
  (SELECT count(*) FROM league_members m JOIN leagues l ON l.id = m.league_id
      WHERE l.deleted_at IS NULL AND m.is_placeholder)                                      AS placeholder_seats,
  (SELECT count(*) FROM drafts, w WHERE NOT is_mock AND started_at   BETWEEN w.s AND w.e)   AS drafts_started,
  (SELECT count(*) FROM drafts, w WHERE NOT is_mock AND completed_at BETWEEN w.s AND w.e)   AS drafts_completed,
  (SELECT count(*) FROM drafts WHERE NOT is_mock AND status IN ('live','paused')
                                 AND current_deadline < now())                              AS drafts_stuck_now,
  (SELECT count(*) FROM drafts WHERE NOT is_mock AND status = 'paused')                     AS drafts_paused_now,
  (SELECT json_object_agg(verb, n) FROM (SELECT verb, count(*) n FROM platform_operator_actions, w
      WHERE created_at BETWEEN w.s AND w.e GROUP BY verb) x)                                AS operator_actions,
  (SELECT json_object_agg(action_type, n) FROM (SELECT action_type, count(*) n FROM commissioner_actions, w
      WHERE created_at BETWEEN w.s AND w.e GROUP BY action_type) x)                         AS commissioner_actions,
  (SELECT count(*) FROM job_pauses, w WHERE paused_at BETWEEN w.s AND w.e)                  AS pauses_opened,
  (SELECT count(*) FROM job_pauses WHERE resumed_at IS NULL)                                AS pauses_open_now,
  (SELECT json_object_agg(status, n) FROM (SELECT wk.status, count(*) n FROM league_weeks wk
      JOIN leagues l ON l.id = wk.league_id WHERE l.deleted_at IS NULL GROUP BY wk.status) x) AS weeks_by_status,
  (SELECT count(*) FROM cron.job_run_details d, w
      WHERE d.status = 'failed' AND d.start_time BETWEEN w.s AND w.e)                        AS cron_failed_runs;

-- the per-verb commissioner tables, same window
WITH w AS (SELECT timestamptz '2026-01-01 08:00+00' AS s, timestamptz '2026-01-01 08:00+00' AS e)
SELECT t, count(*) FROM (
  SELECT 'autopilot' t, created_at FROM commish_autopilot_actions UNION ALL
  SELECT 'bracket',  created_at FROM commish_bracket_actions  UNION ALL
  SELECT 'faab',     created_at FROM commish_faab_actions     UNION ALL
  SELECT 'lineup',   created_at FROM commish_lineup_actions   UNION ALL
  SELECT 'matchup',  created_at FROM commish_matchup_actions  UNION ALL
  SELECT 'roster',   created_at FROM commish_roster_actions   UNION ALL
  SELECT 'schedule', created_at FROM commish_schedule_actions UNION ALL
  SELECT 'setting',  created_at FROM commish_setting_actions  UNION ALL
  SELECT 'team',     created_at FROM commish_team_actions     UNION ALL
  SELECT 'trade',    created_at FROM commish_trade_actions) a, w
WHERE a.created_at BETWEEN w.s AND w.e GROUP BY t ORDER BY t;
```

To class a row (§4.3) read its `reason` and `metadata` in the dashboard, not in the repo.

---

## 6. Records

### Rung 1 — Staff · baseline measured 2026-10-20 (production, read-only SELECTs, all-time)
- Leagues in the rung: **1** (in season) · human seats: **1** · placeholder seats: **11** · practice drafts: 0.
- Drafts: **1** real complete (2026-09-09); none open, none stuck.
- Weeks: **5 final**, 1 live, 11 upcoming. Re-scored: **2** (weeks 1 and 2, 2026-09-29) — **FIX**: the D/ST yards were missing from our scoring; re-scored on Chris's instruction (our scoring bugs get fixed). Those two weeks would not count as "without a page".
- Operator actions: **0**. Job pauses: **0** opened, **0** open.
- Commissioner log: `commissioner_actions` 7 (5 `edit_lineup`, 2 `rescore_final_week`); `commish_lineup_actions` 5; every other `commish_*` table 0. The five lineup edits are **unclassed** — Chris to class (§4.3).
- Cron, last 7 days: 13 jobs, **0 failed runs** (ping caveat, §4.2 item 5).
- **§5 re-run after review (R1613, 2026-10-20)** — the edited SELECTs ran on production as written: seats and weeks unchanged (no deleted leagues exist), `drafts_paused_now` 0.
- **§5 dry-run** over the draft's window (2026-09-04 → 2026-09-15 07:00 UTC): both SELECTs ran as written. 1 draft started and completed; 0 operator actions; 5 `edit_lineup`; 0 pauses; **2 failed cron runs**, both 2026-09-11 14:50 UTC in the same minute (`score-week-ping`, `sync-live-ping`: the cron secret was not yet set up; no other failed run in the window). That is a system fault that left **no** operator or commissioner row — the shape §4.2 item 5 exists to catch, and the weekend record must list it as a FIX.
- Against §2's leave condition: ≥1 draft ✓ · ≥2 weeks final ✓ · open S0/S1 from it — none known to this record. **Leaving rung 1 and inviting rung 2 is Chris's call.**
- Ruling: **awaiting Chris.**

*Rungs 2 and 3 not started (2026-10-20). The live draft weekend (§4) has not happened yet; it is recorded here when it does.*
