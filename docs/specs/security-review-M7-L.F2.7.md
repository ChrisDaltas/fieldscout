# Security review: internal pass (M7 L.F2.7)

> **What this is.** The internal security review that spec §19.3 (v2.16.100) and Q90 (c) call for. It covers every table, function and grant, plus M8's operator surface. It produces **findings, not fixes** (TD7 / D576). Each finding is rated S0–S3 using the TD6 / D575 definitions:
> - **S0:** a wrong score, standing or result; data loss; or a permission breach.
> - **S1:** a live draft or scoring weekend cannot complete without operator help.
> - **S2:** a real weakness with a bounded reach.
> - **S3:** hygiene or hardening.
>
> Fixes go to **L.F2.8**, one PR per finding group. The outside review before launch is L.F2.14.
>
> **Date:** 2026-10-20. **Reviewer:** a fresh agent session, not the builder of any surface reviewed. **Code:** `main` @ `4bd5514`, migrations head **199**, pgTAP head **149**.
>
> **The repo is public, so S0 and S1 entries here are redacted.** Each one appears below as a single line with no location, mechanism or reproduction. The details went to Chris privately, in this task's report. When L.F2.8 lands a fix, its PR may describe that finding in full.

---

## 1. How the review was done

Four sources, all read-only.

1. **Live catalog of the local stack**, freshly at head 199. Catalog `SELECT`s covered:
   - RLS flags on every table in `public`, `storage` and `realtime`.
   - Every policy, flattened.
   - Table privileges for `anon` and `authenticated`.
   - Every `SECURITY DEFINER` function: its `search_path`, its EXECUTE ACL per role, and its body.
   - Every invoker function those roles can execute.
   - Trigger enable modes.
   - Storage buckets, publications, cron jobs, default ACLs, schema usage, and views with owner rights.
2. **Rolled-back probes on the local stack.** Each ran inside `BEGIN … ROLLBACK` as `authenticated` with a forged `sub`, to confirm or kill a candidate. Nothing was committed, and nothing was run against production.
3. **Production, `SELECT` only, through the Supabase connector.** Five catalog/metadata reads in total:
   - an object-by-object parity diff of the `public` schema's grants, policies, triggers and function definitions against the local chain at the same head;
   - two narrow follow-ups;
   - one count over `auth.users`.

   No row data was read beyond what is needed to state a finding.
4. **Source reading**:
   - all 144 route handlers under `src/app/api/**`;
   - the admin gate, `/app/admin` and middleware;
   - the cron routes, dev auth, the AI routes and the auth callback / sign-in flow;
   - `.github/workflows`;
   - the bodies of all 95 `authenticated`-executable SECURITY DEFINER functions and the `*_internal` functions behind them.

Two parts were delegated to sub-agents: the in-body authorization audit of the large RPC bodies, and the route-handler sweep. Their findings were re-checked here before being rated.

---

## 2. Findings

### 2.1 S0 / S1 (redacted; details held privately, fix tasks in L.F2.8)

| Ledger | Sev | Redacted line | Fix group |
|---|---|---|---|
| **F710** | S0 | A permission breach on production. **Not reproducible from the repo.** | L.F2.8 G1 (migration + Chris's `db push`) |
| **F711** | S0 | A permission breach in the browser sign-in flow. | L.F2.8 G2 (app code) |
| **F712** | S0 | A data-integrity breach on a non-league surface. | L.F2.8 G3 (migration) |
| **F713** | S0 | An account-access problem on production. | L.F2.8 G4 (an operator step by Chris, plus a small repo change) |

No S1 finding. Nothing found blocks a live draft or scoring weekend from completing.

### 2.2 S2

| Ledger | Finding | Evidence | Who can reach it |
|---|---|---|---|
| **F714** | **`notify_list_followers` has no list-ownership check.** It verifies only that `p_actor = auth.uid()`, then writes or refreshes a `list_updated` bell entry ("@caller updated <title>") for every follower of any non-deleted list. The result is unlimited, falsely attributed bell spam to other users. | Live body (migration chain head). A rolled-back probe on a list the caller does not own returned without refusal. | `authenticated` (anon EXECUTE was revoked in 038) |
| **F715** | **The four public storage buckets have no size limit and no MIME allow-list.** The buckets are `user-avatars`, `list-thumbnails`, `folder-thumbnails` and `league-avatars`. The write policies scope by owner folder, which is correct, but any file type and any size up to the platform default can be stored and served publicly from the project's storage origin. That makes them free hosting for arbitrary files. | `storage.buckets`: `file_size_limit` and `allowed_mime_types` are both NULL on all four, locally and on production | `authenticated` (in their own folder) |
| **F716** | **A co-commissioner can soft-delete the league, or rewrite its profile, while the creator still runs it.** `soft_delete_league` and `update_league_profile` gate on `is_league_commish`, which admits `co_commissioner`. `remove_manager` and `set_member_role` do block a co-commissioner from acting against the creator. Spec §17 gives co-commissioners the commissioner's powers, and §7.2's anti-coup line covers only *removing* the creator. **Chris's call** whether deleting the league counts. Reported, not argued. | Live bodies | `authenticated` co-commissioners |
| **F717** | **AI generation spend has no ceiling across accounts.** The per-account cap (3 per day) is enforced server-side and fails closed. But sign-up is free, there is no global daily ceiling and no per-IP limit, so spend scales with the number of accounts created. `AI_LIST_GENERATION_DAILY_LIMIT=0` is the existing kill switch. | `src/app/api/lists/generate/route.ts`, `src/lib/claude/limits.ts`, `quota.ts` | anyone who signs up |
| **F7** *(existing)* | **Re-measured: username permanence is still not enforced in the database.** A direct `UPDATE profiles SET username = …` by the owner succeeds; a rolled-back probe returned `UPDATE 1`. `spec-auth-profiles.md:16` says a username "is permanent (cannot be changed in V1)". | probe; profiles triggers guard only the reserved namespaces | `authenticated` (own row) |
| **F36** *(existing)* | **Re-measured, unchanged:** a departed creator keeps `SELECT` on their old league row, including the share code. This matches the §12.1 policy as printed (`is_league_member(id) OR owner_id = auth.uid()`), so it conforms to the spec. Kept at S2 because it is a read the product has not chosen on purpose. | `pg_policies` | the departed creator only |

### 2.3 S3 (hardening)

| Ledger | Finding |
|---|---|
| **F718** | **No house-wide structural sweep pins the security posture.** `004_secdef_search_path.sql` pins seven named legacy functions only. Nothing fails CI when a future migration: adds a `public` table without RLS; adds a SECURITY DEFINER function without `search_path = ''`; or leaves one EXECUTE-able by `anon` outside an allowlist. Today's measurements are all as intended (§3), so this guards against regressions. It matters more because the default ACLs grant `anon`/`authenticated` `arwdxtm` on new tables and EXECUTE on new functions (F17). |
| **F719** | **Eleven legacy (pre-leagues) SECURITY DEFINER functions pin `search_path = public, pg_temp`, not `''`.** They are `reorder_list_players`, `notify_list_followers`, `enforce_free_list_caps`, `guard_lists_ai_persona`, `guard_profile_admin_column`, `guard_profile_billing_columns` and the five counter triggers. This is not exploitable today, because neither API role has CREATE on `public`. Separately, `league_standings`, `league_standings_projected` and `league_playoff_bracket` use `auth.uid() IS NOT NULL AND NOT member`, which skips the membership check when there is no uid. No API role can reach that branch (`anon` has no EXECUTE). The house's other reads use the fail-closed form. |
| **F720** | **`profiles` is world-readable, including `stripe_customer_id`, `subscription_status`, `is_pro` and `is_admin`.** The billing columns are empty while Pro is suspended. `is_admin` tells anyone which account is the platform operator. |
| **F721** | **App hygiene group:** <br>• The nine cron routes each copy a non-constant-time `!==` bearer compare. They fail closed when the secret is missing. <br>• `.github/workflows/ci.yml` and `db.yml` declare no `permissions:` block. <br>• A hosted project identifier is committed in three docs/workflow files. It is not a secret, but the repo is public. <br>• Signed-out read endpoints (`/api/players/*`, `/api/tags`) have no rate limit. F41 / L.F2.6 covers mutations only. |
| **F722** | **`/u/[username]/big-board/week/[week]` reads `big_board_weekly` (owner-only under RLS) with the service role.** It pulls only the `list_id`, then reads the list through RLS, so the only leak is whether a board exists for that week. |
| **F723** | **`net.http_get` / `net.http_post` and `supabase_functions.http_request` are EXECUTE-able by `anon` and `authenticated`.** These are Supabase defaults. Neither schema is exposed through PostgREST (`schemas = ["public", "graphql_public"]`), and no `public` function forwards to them, so they need a raw SQL session as the role. This is the same reach class as F372. |
| **F724** | **Two `public` views run with owner rights** (`security_invoker` unset), so they bypass RLS: `active_game_window` (a boolean over `nfl_games`) and the `consensus_rankings` materialized view (aggregates over public lists only). Both expose only data that is already public. |
| **F17** *(existing)* | Re-measured. TRUNCATE is gone from `anon`/`authenticated` on every `public` table (L.E1.17). The remaining default-ACL breadth (INSERT/UPDATE/DELETE on all tables, RLS as the only gate; EXECUTE on new functions by default) is unchanged. It is now covered by F718's sweep. |
| **F144** *(existing)* | Re-measured. **30** non-internal triggers are at `tgenabled = 'O'` (29 in `public` plus `auth.users.on_auth_user_created`), and 32 are at `'A'`. Guards at `'O'` include `league_weeks_transition_guard` (F4), `leagues_snapshot_guard` (D43), the three `profiles` guards and `handle_new_user`. The door is privileged-only (`session_replication_role = replica`), so this stays S3. |
| **F372** *(existing)* | Re-measured. `REFERENCES` / `TRIGGER` / `MAINTAIN` are still held by both API roles on `public` tables; spot-checked `lists`: TRIGGER `t`, MAINTAIN `t`. They need a raw SQL connection as the role and are not reachable through PostgREST. Still Chris's call. |

---

## 3. Checked and clean (measured, one line each)

**Tables and RLS**
- **RLS is on every `public` table** (95 relations). The only RLS-off tables are Supabase-internal `realtime.*` partitions and `subscription`.
- **24 tables run deny-all, with zero policies:** the commissioner / ledger / replay tables, `draft_liveness`, `score_fanout`, `waiver_runs`, `ai_call_log` and `persona_*`. They are reached only through SECURITY DEFINER doors.
- **Every client write policy keys on `auth.uid()`**, so `anon` matches none of them. League tables (rosters, matchups, results, weeks, pool, picks, bids, chat, trades, transactions, waiver claims) have **no client write policy**. They are server-authoritative per §8.1 / §12.
- **Read policies match §12 as printed:**
  - `leagues`, `league_members`, `drafts`, `draft_picks`, `draft_bids`, `draft_queues` (own, plus mock launcher), `league_rosters`, `matchups`, `transactions`, `waiver_claims` (own or commissioner), `trades` / `trade_items` / `trade_drops`, `commissioner_actions` (members), `league_lists`, `league_weeks`, `team_week_results`, `league_player_pool`, `team_managers`, `league_invites` (commissioner), `draft_dnd_marks`, `scoring_systems` (league members), `draft_budget_adjustments`, `player_weekly_projections`, `league_player_values`, `team_autopilot`.
  - `team_lineups` is member-truth (§12.13).
  - `teams` is world-readable on purpose, as the §17 "public league summary" (053:24).

**Audit and integrity guards**
- `commissioner_actions` and `platform_operator_actions` are immutable. UPDATE/DELETE and TRUNCATE are blocked by triggers at `ENABLE ALWAYS`, plus there is no write policy.
- League scoring rules can change only through `scoring_update_rules`. Direct writes to a league's `scoring_systems.rules` are refused by `scoring_systems_league_rules_guard_internal` (`'A'`).
- Admin self-promotion is blocked: a rolled-back `UPDATE profiles SET is_admin = true` as `authenticated` raised "Admin status is managed by the system". `profiles` has no INSERT policy.

**Functions and grants**
- **Every SECURITY DEFINER in `public` pins a `search_path`**: 133 use `''`, and the 11 legacy ones use `public, pg_temp` (F719).
- **`anon` can EXECUTE only the intended SECURITY DEFINER functions** (measured on the local chain): `get_join_preview` (§12.23 preview, F2-pinned); the RLS helpers the `{public}` policies evaluate (`is_league_member`, `is_league_commish`, `is_standalone_mock_launcher`, `team_is_mock_seat`, `team_league_id`); `reorder_list_players` (which owner-checks in-body); and trigger functions, which cannot be called directly.
- **Every `authenticated`-executable SECURITY DEFINER RPC (95) gates in-body**, either directly or through a gated `*_internal`. Every id parameter (team, player, matchup, draft, pick, claim, trade) is bound back to the gated league. The parts:
  - **Gates.** Commissioner verbs use `is_league_commish` under the league lock. Manager verbs bind `league_members.team_id = p_team_id AND user_id = auth.uid()`. Mock drafts use `launched_by = auth.uid()`.
  - **Time and reasons.** No API-reachable function takes a client clock; the wrappers pass `now()`. `p_reason` is stored and never drives logic.
  - **Internals.** The `*_internal` functions are not EXECUTE-able by `anon` or `authenticated`. The only exception, `scoring_system_league_use_internal`, gates on `owner_id = auth.uid()` in-body.

**M8 operator surface**
- `is_platform_operator()` reads `profiles.is_admin` for `auth.uid()`.
- Every `op_*` wrapper refuses non-operators with 42501, and `op_verb_prelude_internal` re-checks the gate.
- Every `op_*_internal` is EXECUTE-able by `postgres` and `service_role` only.
- `job_pauses` and `platform_operator_actions` are SELECT-only for operators, with no client write policy.
- All 10 `/api/admin/**` routes call `requireAdminUser`, which answers 404 to signed-out and non-admin callers. `/app/admin/**` is `notFound()`-gated in its layout.
- The operator RPCs are called with the admin's own session client, so `auth.uid()` is the operator.

**Realtime**
- Every broadcast trigger calls `realtime.send(..., private => true)`.
- `realtime.messages` allows SELECT only to league members (or the mock launcher) on `league:` / `draft:` topics, and INSERT only for presence on those topics. **Clients cannot broadcast.**
- No table is in a `postgres_changes` publication.

**Cron**
- Cron → route calls carry a vault-held bearer, and `cron_ping_route` is EXECUTE-able by `postgres` only.
- Every `/api/cron/*` route fails closed without its secret.

**App surface**
- **Every mutating route authenticates first.**
- **Service role is used only:**
  - behind the admin gate;
  - behind the cron secret;
  - in `lists/generate`, after `requireUser`;
  - in `dev/toggle-pro`, which returns 404 in production builds;
  - on the page in F722.
- **League RPCs take their scope from the URL and the actor from the session.**
- **Dev auth cannot run in a production build**: it throws at module load when `NODE_ENV=production`.
- **No SSRF path.** `lists/video-title` accepts only a YouTube id.
- `dangerouslySetInnerHTML` is used only for a static head script and escaped JSON-LD.
- User link URLs are constrained to `https?://` in the database (080).
- No committed live keys. The only JWTs in the repo are the public local-demo keys.
- No `pull_request_target` in the workflows.

**Production parity**
- Production and the local chain at head 199 were diffed object by object. One divergence was found; it is held privately under F710.

---

## 4. Ledger rows touched

- **New:** F710–F724, recorded with their severity in PROGRESS §6.
- **Re-measured, severity noted, kept open:** F7 (S2), F17 (S3), F36 (S2), F144 (S3), F372 (S3).
- **Decision:** D610.
