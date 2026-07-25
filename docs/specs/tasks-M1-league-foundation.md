# M1 Task Breakdown — League Foundation

> **Architect session output — 2026-07-20** (adversarially reviewed same session; findings applied). Read together with `spec-redraft-leagues.md` **v2.7.1** (the LAW) and `delivery-plan-redraft-leagues.md` **v1.3**. This doc sequences M1 into Builder-sized tasks (each ≤ half a day); it never overrides the spec. Builder sessions take **one task each**, in dependency order (§6), and satisfy delivery plan §2.3 DoD per task **plus the M1 standing rules (§4)**.
>
> **Gate re-cut (delegated by delivery plan v1.3):** the *Alpha/Ultra backtest harness* is removed from the M1 exit criteria entirely — it returns as a gate item of whichever milestone un-punts advanced stats (spec v2.7 funding decision). Nothing replaces it. The remaining M1 gate is §1 below, verbatim.

**Spec sections in scope:** §7.1 (lifecycle), §7.2/§7.2.1 (membership, identity, invites, franchise/stints), §7.3 (full settings catalog incl. §7.3.2 roster/DL/Hot Swap and §7.3.8 validation), §7.3.3 + Appendix B (templates, snapshot, extensibility), §12.0–12.2, §12.17, §12.22–12.23 (schema), §15.1 (API), §16.1/16.2/16.5.1–16.5.2 (M1 UI slice), §17 (permissions)
**Delivery plan:** §3 M1 row (contents + exit criteria), §2.1–2.3 (loop + DoD), §8.1–8.4 (checklists)

---

## 1. M1 contents & exit criteria (restated from delivery plan §3, with the re-cut applied)

**Contents:** Tasks L.A1–L.A2 with the v2.0 settings catalog (schedule_mode/median/second, locks, correction window) · scoring **snapshot** plumbing · `league_weeks` · identity contract + seat-targeted invites + `team_managers` stints written from day one (§7.2/§7.2.1/§12.22–23) · the **6 parity scoring templates** + template-picker UX (§7.3.3/App B — no custom editor, no Alpha/Ultra teaser cards; Chris 2026-07-18, spec v2.7) · DL preset + Hot Swap naming in the roster builder.

**Exit criteria (all must pass; proof map in §8):**
1. **Spec §18 Phase A gate:** a commissioner can create an 8/10/12/14/16-team league, fully configure it (defaults valid), invite & seat managers, and reach `scheduled`.
2. **Snapshot present from draft start:** M1 ships the freeze mechanism + a DB-level guarantee that no league can be in `drafting`+ with a NULL `scoring_rules_snapshot`. (`draft_start` itself is M2 — M1 proves the mechanism and the enforcement directly; M2's `draft_start` calls it. D43.)
3. **Settings round-trip tested for every §7.3 field:** create → PATCH a non-default value for every catalog field → read back equal, through the real API path.
4. **Template parity tests:** each of the 6 platform templates' calculator output matches hand-computed scores for 5 canonical player-weeks, to the cent (2-decimal half-up per §7.3.3).
5. *(removed — see header)* ~~Alpha/Ultra backtest harness~~.

**Sequencing disposition (not a conflict):** spec §18 Phase A lists §7.4 list-attachment (`league_lists`, §12.15); the delivery plan — the sequencer — puts all of it (task L.B4: migration + attach UI + draft-room panel) in **M2**. M1 does not touch `league_lists`. (D32.)

---

## 2. Current state (surveyed 2026-07-20; multi-agent survey, every fact file:line-verified)

- **Green field on M1 symbols.** `league_members`, `league_invites`, `team_managers`, `league_weeks`, `is_league_member`, `is_league_commish`, `scoring_rules_snapshot`, `invite_slug` appear nowhere in `src/` or `supabase/` — only in the spec docs. Next migration = **040** (M1 reserves 040–047; the same-day C15 hardening chip took **048** + pgTAP **004** on `fix/C15-secdef-search-path` — see C15). M1 pgTAP files are **005–011**. *(Overtaken by drift, 2026-07-20: review-fix files took 008 and 011 — the batch-2 remediation and the batch-4 R52 closure (`011_player_stats_box_columns.sql`) — so the remaining M1 pgTAP files run into **012+**; Builders confirm the next free number at task time, same policy as migrations.)*
- **`leagues` (001) matches §12.1's declared starting point exactly** — all 12 expected columns present, none extra; `invite_code TEXT UNIQUE` exists but nothing generates/reads it. The old SELECT policy keyed off `teams.league_id` ("Leagues are viewable by members", 001:866) is exactly what §12.1 replaces. `roster_settings` default is the legacy flat shape (`{"qb":1,...}`) — 040 replaces the default with the §7.3.2 canonical shape (C9; no app code has ever written a `leagues` row).
- **`teams` (001:493–505):** `owner_id` NOT NULL, **`list_id` NOT NULL FK lists** (blocks bare league teams — C3), `league_id` nullable, `wins/losses/total_points`, **no** `status`/`deleted_at` (no §12.22 collision). RLS: world-readable SELECT + **"Users can manage own teams" FOR ALL** (client-writable incl. `wins`/`league_id` — C4). App code never queries `teams`; the product's "teams" today are `lists.is_team = TRUE` rows, and the free-1-team cap (018 trigger + API check) fires **on `lists` only** — league `teams` rows are not capped (join-free is safe once C3/C4 are fixed).
- **`scoring_systems` (001:181):** `owner_id` nullable ✓; flag is **`is_system_default`**, no `is_template` (C7); `rules JSONB` never seeded anywhere; RLS = own-rows + is_system_default-readable.
- **Scoring code:** the fantasy-points utility is `calculateFantasyPoints()` in **`src/lib/scoring/default.ts`** (`src/utils/calculate-fantasy-points.ts` does not exist — spec path erratum, v2.7.1). It is a hardcoded 19-key function, missing→0, 1-decimal rounding, and its rules namespace ≡ `player_stats` **column** names (`xp_made`, `def_sacks`, `two_point_conversions`, stacking `fg_made`+`fg_made_40_plus`…) — 10 divergences from the canonical registry namespace. Not reusable for §7.3.3 (C8/D33). Six consumer files — five read-time surfaces (16 call sites) + the projections mapper `sleeper.ts` (shape-coupled, no direct calls) — all use the legacy namespace; they are research surfaces, untouched by M1.
- **`STAT_KEYS` registry (M0):** full App B.1+B.4 canonical set — 26 column-mapped, 19 deferred (incl. the 7 `def_pa_*` tiers), 2 D15 placeholders. `def_ya_*` absent (Q3: approved, unseeded). No `def_yards_allowed` raw key either.
- **Identity:** `profiles.username` is plain `TEXT UNIQUE NOT NULL` — no length/charset CHECK, no citext anywhere (only extension is pgcrypto); the only validation is a client regex `/^[a-zA-Z][a-zA-Z0-9_]{2,29}$/` (3–30, must start with a letter), lowercased app-side at write. §7.2 wants citext 3–20 `[a-z0-9_]` *and changeable* usernames; spec-auth-profiles.md says **permanent** and states no charset rules (C5 → **Q4**). `profiles` has **no email column** (email lives in `auth.users` only — claim-time `invited_email` matching reads the JWT/auth record, never profiles). `/u/[username]` route exists.
- **Email:** **zero outbound-email capability** — no email lib in package.json, no `supabase/functions/`, production SMTP commented out; only Supabase Auth's built-in mails + the local dev capture inbox. §7.2's primary invite channel has a missing dependency (C6 → **Q5**, D37 seam).
- **In-app notifications:** real end-to-end infra exists (`notifications` table, no-INSERT-policy + SECURITY DEFINER insert pattern per 019, routes, `use-notifications`) — the username-invite notification reuses it; `type` is free TEXT.
- **League/draft UI:** a complete **mock-data** surface already exists in the **new Field Scout design language**, gated behind `featureFlags.leagues` (`src/app/app/leagues/*`, `src/components/leagues/*` 12 files, `src/components/draft/*` 7 files). Every mutation is a toast stub; the only wired piece is `best-available-card.tsx`. No `/api/leagues*`, no `/join`, no league hooks/stores. M1 **wires or replaces these components in place** (CLAUDE.md redesign rules: re-skin/reuse, no parallel tree). Repo route convention is `src/app/app/leagues/...` — spec §16.1's `(app)` group prefix is illustrative (C10).
- **Conventions:** scripts are `lint` / `type-check` / `test` / `test:db` / `test:gate`; supabase CLI exact-pinned 2.109.1; PG 17. ESLint time/random guard covers `src/lib/leagues/**` recursively — new M1 dirs under it are auto-guarded; app routes/hooks are NOT guarded. `src/types/database.ts` hand-written alias block at lines ~2377–2431 — every typegen re-appends it (and M1 extends it with new league table aliases). config.toml `[db.seed]` is enabled and points at `./seed.sql` — the file doesn't exist yet, so resets currently seed nothing; any seed file created at that path runs on every `db reset`.
- **RPC convention divergence (M0 §8 note, now in force):** existing functions use `SET search_path = public, pg_temp`; seven pre-017 SECURITY DEFINER functions set **no** search_path at all (C15 — pre-existing, routed to the M7 security review, not M1; **resolved 2026-07-20 — pulled forward per Chris, migration 048 + universal pgTAP pin, D45**). **Every M1 RPC uses the spec form** (§4 standing rules).
- **Grant model (D23):** 037's default ACLs auto-grant ALL on every new table/function to anon/authenticated/service_role. RLS/REVOKE is the only gate; 038 is the REVOKE precedent.

---

## 3. Design decisions (Architect; logged as D31–D44 in PROGRESS §4)

- **D31 — Gate re-cut.** Alpha/Ultra backtest harness removed from the M1 gate (delivery plan v1.3 delegation); returns with funded advanced stats. No replacement item.
- **D32 — §7.4/`league_lists` sequenced to M2** with L.B4 per the delivery plan M2 row. Phase A's mention is contents, not gate; the Phase A gate (§1.1) doesn't exercise lists.
- **D33 — New generic calculator; legacy untouched.** §7.3.3's dot-product lives in **`src/lib/leagues/scoring/`** (pure, canonical-key namespace, pending-not-zero, NUMERIC(8,2) half-up). `src/lib/scoring/default.ts` and its six research-surface consumers are NOT migrated in M1 (different product surface, legacy namespace ≡ column names). Spec path refs corrected as erratum v2.7.1. Unifying research surfaces onto the generic calculator is a later, deliberate migration — never a silent one.
- **D34 — Templates via additive `is_template`.** `scoring_systems` gains `is_template BOOLEAN NOT NULL DEFAULT FALSE` (spec names it; `is_system_default` keeps its existing research-surface meaning) + a world-readable SELECT policy for template rows + seed of the 6 parity rows (`owner_id NULL`). Template rows are service-role-managed; existing owner-scoped policies can't touch `owner_id NULL` rows.
- **D35 — `teams` gap fixes (spec erratum v2.7.1).** (a) `list_id` DROPs NOT NULL — league franchises carry no backing list; standalone team-lists unaffected. (b) "Users can manage own teams" is replaced by an owner-manage policy scoped `league_id IS NULL` — league teams are written only via SECURITY DEFINER RPCs (server-authoritative, §8.1/§12). World-readable SELECT stays (public league summary, §17). The free-1-team cap (018) continues to target `lists.is_team` only — league teams are never capped (join stays free).
- **D36 — Username handling (superseded by the Q4 ruling, 2026-07-20).** ~~M1 does NOT migrate `profiles.username`~~ **Superseded by the Q4 ruling (Chris, 2026-07-20):** usernames are 5–20 chars and **permanent**; no grandfathering (no production users); the DB CHECK + `lower(username)` unique index move into **040 (L.A1.1)**, not 043; no citext conversion (lower() index is the mechanism, per the ruling). Application was briefly halted on Q7 (persona `*-ai` handles; the settings rename flow) — **Q7 ruled same day** (persona exemption in the CHECK + guard trigger; settings field display-only; permanence = post-selection) — see PROGRESS §3 Q7 and L.A1.1.
- **D37 — Email behind a seam.** `EmailSender` interface (`src/lib/email/`) with a dev implementation (logs + writes to the local capture path) so the invite flow is fully built and tested vendor-free ("prove it free", plan principle 2). **Confirmed by the Q5 ruling (Chris, 2026-07-20): interface only, NO vendor binding in M1; vendor selection waits until invite-send mail is ready to ship. The v1 minimum bar, vendor-independent: the league join link is always visible and copyable by the league manager (L.A2.5).** The seam is app infra (not under `src/lib/leagues/` — it does I/O; not subject to the time guard).
- **D38 — M1 realtime-trigger waiver (D10-style, citable).** New M1 tables (`league_members`, `team_managers`, `league_invites`, `league_weeks`) — **and the existing `leagues` table as 040 extends it** (same rationale) — get **no** Broadcast-from-DB triggers yet: no live subscriber exists in M1's UI slice (CRUD pages; React Query refetch). Triggers ship with M2's draft room / `league:<id>` channel work, where §9.2's channel-auth policy lands too. Plan §8.1's realtime line is disposed per task via this waiver.
- **D39 — E2E deferral waiver for the Phase A gate.** Playwright doesn't exist in the repo (M0 §8; plan §4.1 puts first E2E in M2). The M1 gate proves Phase A at the **integration level** (real Route Handlers + RPCs against the local stack) plus a browser-verified UI pass (screenshots in the gate session log). The Phase A *E2E* lands in M2 alongside the Playwright bootstrap.
- **D40 — D24 source-semantics disposition.** M1 ingests nothing into real tables; the non-`'sleeper'` `source` value concern lands with **M4** (first synthetic/fixture ingestion into a real DB, Phase D synthetic gate). Recorded so M4's Architect inherits it explicitly.
- **D41 — D5's deferred-key storage mapping lands in M1 as migration 045** (box-score columns for deferred core_box keys, incl. per-type 2-pt per D20), **evidence-gated**: adapter mappings are added only where the checked-in real 2025-wk2 fixture (or live-stats repo evidence) proves the Sleeper field; keys without evidence stay `deferred` with a note. This is also D5's "adapter core_box completeness re-verified in M1" checkpoint. The D22/R10 `xpmiss` caveat stays open until the first real 2026 actuals recording (September) — not an M1 blocker.
- **D42 — §7.2.1 scope cut: full signatures, pre-draft semantics.** M1 ships the stint machinery (open/close, one-open-stint index), `assign_manager` / `remove_manager(mode)` / claim RPCs with the full three-outcome signature — but implements the **pre-draft** consequences only (seat swap / placeholder-ize; no roster/FAAB/W-L exists yet). In-season takeover/retire-&-succeed/vacate consequence machinery (inheritance, seeding-only W-L, autopilot, auto-rescind) lands with M4/M5 where those objects exist; `retire` mode in M1 returns a friendly "not available before the draft" error (spec: retirement is an in-season/offseason act). The Ghost simulator scenario (plan §4.2) exercises the full lifecycle in M4+.
- **D43 — Snapshot mechanism.** `snapshot_league_scoring(league_id)` SECURITY DEFINER RPC copies the referenced template's `rules` into `leagues.scoring_rules_snapshot` in the same transaction as any `setup/scheduled → drafting` transition (M2's `draft_start` calls it; M1's lifecycle RPC enforces it), backed by a **BEFORE UPDATE trigger on `leagues`** raising on any transition into `drafting/in_season/playoffs/complete` with a NULL snapshot — the §7.3.8 invariant as a DB guarantee, unbypassable by future code paths (same philosophy as the §12.12 backstop trigger).
- **D44 — `dst_model` is template-authoring, not engine.** The dot-product engine sees only keys: ESPN's split D/ST = rules containing both `def_pa_*` and `def_ya_*` tier keys; Yahoo/Sleeper single = `def_pa_*` only. Tier-indicator stats (`def_pa_14_20 = 1` when PA ∈ 14–20) are produced by a pure derivation helper (raw `def_points_allowed` / `def_yards_allowed` → one-hot tier keys) that ships with the calculator. No `dst_model` discriminator exists anywhere in engine code.
- **D46 — `league_invites` send-tracking columns (spec erratum v2.7.1).** *(D45 is the same-day C15 hardening decision, PROGRESS §4.)* §7.2 requires "every send/claim/revoke is recorded", but §12.23's printed DDL has no `created_at` and no send timestamp. Migration 043 additively adds `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` and `last_sent_at TIMESTAMPTZ` (created_at = initial send for email invites; last_sent_at updated on re-send). Folded into the spec's v2.7.1 changelog.
- **D47 — Join-at-capacity = friendly rejection.** §7.2 has an internal tension: path 1 auto-creates a team "while open seats remain" but the Join bullet says "On join, a teams row is created" unconditionally. M1 resolves it as: when active seats (incl. placeholders) = `team_count`, `join_league_by_code` rejects with a friendly "league is full" — no unseated member rows (a state §12.2 doesn't model; revisit if v1.1 wants waitlists). Boundary-tested in L.A1.14. Recorded here + spec changelog note.
- **D48 — Invite pre-auth preview = three fields.** §12.23's comment says the pre-auth claim page exposes "only league name + team label", but §16.2/§16.4/§16.5.2 consistently specify league, team, **and inviter** (the growth-loop design intent). Resolved in favor of §16: `get_invite_preview` returns league name + team label + inviter display name, nothing else. §12.23 comment fixed as erratum v2.7.1.

---

## 4. Standing rules for every M1 task (the M0 threads, made law)

These four are **standing rules** — every Builder cites them in the self-review note; the Reviewer verifies them literally alongside plan §8:

1. **Grants doctrine (D18 → D23).** No per-object GRANT statements — 037's default ACLs already expose everything; RLS is the only effective gate **for tables**. Every SECURITY DEFINER routine (all league RPCs) additionally gets: in-body authorization (§8.3), `SET search_path = ''` with schema-qualified references, and an explicit `REVOKE EXECUTE ... FROM PUBLIC, anon;` in its migration (038 precedent). Pre-auth surfaces (invite-claim preview) get a deliberate, documented anon carve-out instead.
2. **No-write-policy pgTAP pattern.** Every new table's pgTAP proves deny-by-default **per role** (anon, authenticated non-member, member, commissioner): `policies_are` pins the exact policy list; writes that RLS *filters* silently (UPDATE/DELETE) are tested with the **RETURNING-count pattern** against seeded rows (003_nfl_weeks precedent), preceded by a same-role SELECT-sees-N pin so "0 affected" can't mask "0 rows"; INSERT expects 42501. The 001 global RLS-enabled backstop covers the fail-open case automatically — new tables just must not appear in its exclusion list.
3. **Falsifiability floor (M1 test standard).** Every task ships: (a) **golden pins** — derived values (settings round-trips, template point totals, generated codes/slugs excepted where random) asserted against stored literals, not recomputed; (b) **boundary instants/values** — every comparison (team_count bounds, playoff-week math, invite expiry, min_weeks, stint-close race) tested at the exact edge and one past it; (c) **≥1 deliberate-break probe** shown failing in the session log, then reverted. A test that can't fail for the reason it claims to test doesn't count. *Scoping:* §4.3 applies in full to tasks that ship automated tests (schema, engine, API lanes). UI tasks (L.A2.1–L.A2.7) satisfy the floor via any schema-fixture golden pins their task text names (e.g. L.A2.2's builder-output fixture) plus the D39 browser-verified pass with screenshots in the session log — cite this sentence in the self-review note.
4. **Migration checklist + waivers.** Plan §8.1 applies to every migration; the staging-clone rehearsal line is disposed via the R6 go-forward rule (no staging env exists — fresh local `db reset` replay is the recorded rehearsal evidence, waiver cited in the migration banner). Realtime line disposed via D38. Typegen re-appends the database.ts alias block (extend it with new league aliases) — verify block location (~2377) at task time.

---

## 5. Interface sketches (Builder finalizes exact fields; names below are contractual)

```ts
// src/lib/leagues/settings/league-settings.ts  (§7.3 catalog — one Zod source of truth)
export const leagueSettingsSchema: z.ZodType<LeagueSettings>  // EVERY §7.3.1/7.3.4–7.3.8 field, spec defaults/ranges
export const rosterSettingsSchema: z.ZodType<RosterSettings>  // §7.3.2 canonical JSONB: starting_slots[], bench, ir_slots[], swap_spots
export const DL_PRESET: IrSlotConfig       // §7.3.2: restricted, [OUT, IR, Doubtful], min_weeks 4 — label "DL"
export const LEAGUE_SETTINGS_DEFAULTS: LeagueSettings         // creation defaults, verbatim from §7.3 "D" columns
export function validateLeagueSettings(s: LeagueSettings, ctx: { draftablePoolSize?: number }): ValidationResult
// implements every §7.3.8 "Validation rules" bullet; returns per-field, human-readable errors (they are UX)
export function splitSettings(s: LeagueSettings): { columns: LeagueTypedColumns; blob: Json }  // §12.1 typed-column/JSONB split
export function mergeSettings(row: LeagueRow): LeagueSettings                                  // inverse; round-trip identity is a pinned test
```

```ts
// src/lib/leagues/scoring/calculator.ts  (§7.3.3 — the generic dot-product; D33)
export interface ScoreBreakdown {
  total: number                      // half-up, 2 decimals (§7.3.3 precision rule)
  perKey: Record<string, number>
  pending: string[]                  // rules keys with no delivered stat — pending, NEVER zero (§23.5/E61)
}
export function scorePlayerWeek(rules: Record<string, number>, stats: Record<string, number>): ScoreBreakdown
// Σ rules[key] × stat(key); stat keys with no rules entry ignored; NO key translation anywhere (§7.3.3 one namespace)

// src/lib/leagues/scoring/derive-stats.ts  (D44)
export function deriveTierIndicators(raw: Record<string, number>): Record<string, number>
// def_points_allowed → one-hot def_pa_*; def_yards_allowed → one-hot def_ya_* (ESPN buckets per Q3/L.A1.7)
```

```sql
-- create_league RPC shape (L.A1.12; §15.1 POST /api/leagues)
create_league(p_name, p_season, p_team_count, p_settings jsonb, p_roster_settings jsonb,
              p_scoring_system_id uuid, p_team_name text) RETURNS jsonb
-- SECURITY DEFINER SET search_path=''; in-body: auth (no is_pro gate — Q6 ruling, v2.8:
-- creation is free) + p_scoring_system_id
-- must reference a scoring_systems row with is_template = TRUE AND owner_id IS NULL
-- (v1 templates-only rule, §7.3.3; §7.3.8 "exactly one scoring system referenced and readable");
-- single txn: leagues row (typed cols + blob via the splitSettings contract, invite_code
-- generated, max_teams := team_count) + commissioner league_members row (faab_balance seeded
-- from faab_budget, §12.2) + teams row (league_id set, list_id NULL) + first team_managers
-- stint. REVOKE from PUBLIC, anon.

-- claim_league_invite RPC shape (L.A1.14; §12.23)
claim_league_invite(p_token text) RETURNS jsonb
-- pre-auth preview variant (get_invite_preview / get_join_preview) resolves seat token →
-- invite_code → invite_slug and exposes ONLY league name + team label + inviter display
-- name (§12.23 as amended by D48/erratum v2.7.1; §16.2/§16.4); claim path:
-- validates not expired/revoked/spent → invited_email/invited_username match vs auth
-- record (JWT email claim; lower(username) per D36; E53/E65) → seats claimer: league_members
-- upsert + teams attach (or placeholder claim) + OPEN STINT — one txn; the one-open-stint
-- unique index converts the E54 double-claim race into a friendly "seat already filled".
```

**Status transitions in M1:** `set_league_status(league_id, 'scheduled'|'setup')` RPC validates §7.1 (scheduled requires settings-valid + `draft_scheduled_at`); the D43 trigger blocks `drafting`+ without a snapshot. Transitions beyond `scheduled` are M2+.

---

## 6. Task list (one Builder session each; ≤ half a day)

Dependency order — three lanes; **schema lane serialized** (plan §2.2), engine lane pure-TS parallel, API/UI fan out behind their dependencies:

```
SCHEMA  L.A1.1(040) → L.A1.2(052) → L.A1.3(053) → L.A1.4(055) → L.A1.5(056) → L.A1.7(057) → L.A1.9(058) → L.A1.11(059)
        (numbers per the corrected §7 table — 048–051 and the 054 review-fix migration took the original reservations)
ENGINE  L.A1.6 (no deps — parallel from day one) · L.A1.7 → L.A1.8 → L.A1.10 (L.A1.10 also needs L.A1.9's authored rules)
API     {L.A1.2, L.A1.3, L.A1.6, L.A1.9} → L.A1.12 → L.A1.15 · {L.A1.6, L.A1.11, L.A1.12} → L.A1.13 · {L.A1.4, L.A1.12} → L.A1.14
UI      L.A1.6 → L.A2.2 · L.A1.9 → L.A2.3 · L.A1.12/13 → { L.A2.1, L.A2.7 } · {L.A1.13, L.A2.2, L.A2.3} → L.A2.4
        · L.A1.14/15 → { L.A2.5, L.A2.6 } · L.A2.5 → L.A2.7 (invite affordances)
GATE    everything → L.A1.16
```

### L.A1.1 — Migration 040: citext + §12.1 leagues settings columns + Q4 username contract
> Read spec §12.1, §7.3 (typed-column list), §7.2 identity contract (v2.8), delivery plan §8.1–8.2, this doc §3–4. Schema lane opener.
>
> **Q4/Q7 rulings (Chris, 2026-07-20) fold the username contract into this task's schema work:** `profiles.username` CHECK `^[a-z0-9_]{5,20}$ OR ^[a-z0-9]+(-[a-z0-9]+)*-ai$` (persona exemption, Q7.1) + the `lower(username)` unique index (D36's 043 slot superseded — the index moves here) + a 025-pattern namespace-guard trigger (authenticated/anon can never write a persona-pattern username) + the settings-page username field goes display-only (Q7.2 — permanence is post-selection; no DB permanence trigger yet) + `seed-dev-user.ts` `'dev'` → `'dev_user'` (Q7.3). *(History: halted 2026-07-20 on the stop condition when the persona handles + settings rename flow surfaced; resumed same day on the Q7 ruling — PROGRESS §3 Q7. In-session adversarial review then found the signup-metadata bypass — fixed as **migration 049** since 048 re-creates `handle_new_user` after 040; plus the `/username` post-selection gate, index-expression + multi-segment pins, and full §12.1 type/NOT-NULL coverage. Fact correction: the roster personas live in `ai_personas`, not `profiles` — only `fieldscout-ai` is a persona-pattern profiles row.)*
>
> 1. `040_leagues_settings_columns.sql`: `CREATE EXTENSION IF NOT EXISTS citext;` + §12.1's ALTER verbatim (status, format, team_count CHECK (8,10,12,14,16), regular_season_weeks, playoff_teams, playoff_start_week, waiver_type, faab_budget, trade_review, trade_deadline_week, lineup_lock, settings JSONB, scoring_rules_snapshot, deleted_at). Replace the `roster_settings` DEFAULT with the §7.3.2 **preset-table Default counts rendered in the canonical `starting_slots[]` shape** — QB1/RB2/WR2/TE1/FLEX(W/R/T)1 keyed `flex`/K1/DST1, `bench` 6, `ir_slots` [one unrestricted spot, designations OUT+IR], `swap_spots` 0 — NOT the spec's printed multi-flex JSONB example, which illustrates the unique-key shape (two flexes), not the defaults (C9; spec erratum v2.7.1 — no app code has ever written a leagues row; verify `SELECT count(*) FROM leagues` = 0 on the local reset and note the prod check in the PR).
> 2. **No policy changes yet** (L.A1.2's migration — landed as 052 — owns the swap; helpers need `league_members` to exist first).
> 3. pgTAP 005: column/constraint pins (team_count CHECK at 8 and 16 pass, 7/9/18 fail; status default 'setup'), canonical roster_settings default golden-pinned.
> 4. Typegen + alias block re-append (add `League` alias).
>
> DoD: §4 standing rules; `db reset` 001–040 clean; deliberate-break probe (e.g. widen the CHECK) shown failing pgTAP.

### L.A1.2 — Migration 052 *(landed; was reserved as 041)*: league_members + §12.0 helpers + leagues policy swap
> Read spec §12.0–12.2, §17, delivery plan §8.2, this doc §4. Depends on L.A1.1.
> *(2026-07-20, post-landing: items 1–2's "keep 'League owners can manage'" and the "Commish manages members" FOR ALL policy are superseded by the Q8 ruling / spec v2.8.2 — migration 054 dropped the owner write policy and replaced the commish FOR ALL with a placeholder-seat INSERT/DELETE pair, no client UPDATE. See PROGRESS R37/R38.)*
>
> 1. `041_league_members_and_helpers.sql`: `league_members` per §12.2 verbatim (incl. `faab_balance`, `UNIQUE(league_id, user_id)`, `UNIQUE(league_id, team_id)`, both indexes); then `is_league_member` / `is_league_commish` per §12.0 **with the v2.0 hardening applied** (`SET search_path = ''`, schema-qualified) — note §12.0's printed bodies omit it; the hardening note is normative; then the §12.1 policy swap (DROP "Leagues are viewable by members"; CREATE the `is_league_member(id) OR owner_id = auth.uid()` SELECT policy; keep "League owners can manage").
> 2. league_members policies per §12.2 ("Members viewable by league members", "Commish manages members") — add an explicit `WITH CHECK (is_league_commish(league_id))` to the commish FOR ALL policy for clarity/pinning. (Not a spec hole: Postgres applies a FOR ALL policy's USING expression to new rows when WITH CHECK is omitted, so §12.2's printed policy already denies non-commish INSERTs — the same implicit-check semantics cover the other FOR ALL USING-only policies in §12; don't flag them as deviations, and don't use dropping the WITH CHECK as the deliberate-break probe — it's behaviorally a no-op.)
> 3. pgTAP 006: §4.2 pattern per role — non-member sees nothing; member sees own league's rows only; commish manages; RETURNING-count denies for manager UPDATE/DELETE; helper truth table (member/commish/neither/anon) against seeded fixtures.
> 4. Typegen + alias (`LeagueMember`).
>
> DoD: §4 standing rules; probe: temporarily re-point the leagues SELECT policy at the OLD teams-based check → pgTAP membership tests fail (shown, reverted).

### L.A1.3 — Migration 053 *(landed; was reserved as 042)*: franchise columns + team_managers + teams RLS replacement
> Read spec §7.2.1, §12.22, erratum v2.7.1 (D35), delivery plan §8.2, this doc D35/D42. Depends on L.A1.2 (team_managers RLS uses `is_league_member`; schema-lane order).
>
> 1. `042_team_franchises.sql`: `ALTER TABLE teams` — §12.22's three columns (status/retired_at_week/successor_team_id) **plus** `ALTER COLUMN list_id DROP NOT NULL` (D35a). `CREATE TABLE team_managers` per §12.22 verbatim incl. `one_open_stint_per_team` partial unique index + user index + RLS ("Stints viewable by league members"; **no client write policies** — writes only via RPCs).
> 2. Teams RLS replacement (D35b): DROP "Users can manage own teams"; CREATE owner-manage scoped `league_id IS NULL` (legacy standalone rows keep working); league teams have **no** client write path. Keep world-readable SELECT.
> 3. §12.22's backfill note is vacuous today (league_members is empty pre-launch) — state that in the banner rather than shipping a no-op backfill.
> 4. pgTAP 007: one-open-stint index (second open stint → 23505); non-league team owner can still UPDATE own row (RETURNING count 1); league-team owner UPDATE denied (count 0, with the SELECT-sees-it pin); stints deny-by-default writes for every role.
> 5. Typegen + aliases (`Team` update, `TeamManager`).
>
> DoD: §4 standing rules; probe: drop the partial index predicate → double-open-stint test fails (shown, reverted).

### L.A1.4 — Migration 055 *(was 043)*: league_invites + invite_slug
> Read spec §7.2 (invite requirements + E53/E54/E65), §12.23 (+ D46/D48 errata), this doc §4. Depends on L.A1.1 (citext — invited_username/invited_email/invite_slug are CITEXT) + L.A1.2 (`is_league_commish` for the SELECT policy); L.A1.3 precedes it by schema-lane serialization only (target_team_id references `teams`, a 001 table). *(The D36 username index moved to L.A1.1/040 per the Q4 ruling, 2026-07-20.)*
>
> 1. `043_league_invites.sql`: `ALTER TABLE leagues ADD COLUMN invite_slug CITEXT UNIQUE;` + `league_invites` per §12.23 **plus the D46 additive columns** (`created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `last_sent_at TIMESTAMPTZ`) (token default via pgcrypto, invited_username/invited_email CITEXT, max_uses/use_count, expiry default 14 days, revoked/claimed columns) + league index + RLS: "Invites viewable by commish" SELECT only; **no client writes** (create/revoke/claim all via RPCs).
> 2. pgTAP 008: commish-only SELECT (manager/non-member/anon see zero rows against seeded fixtures); all client writes denied per role; token uniqueness; expiry default pinned (boundary: `expires_at` exactly 14 days from a pinned insert timestamp); D46 columns present.
> 3. Typegen + alias (`LeagueInvite`).
>
> DoD: §4 standing rules. Note: the pre-auth claim *preview* is deliberately NOT an RLS carve-out — it's a SECURITY DEFINER RPC (L.A1.14) exposing only league name + team label (§12.23).

### L.A1.5 — Migration 056 *(was 044)*: league_weeks
> Read spec §12.17, §23.4, this doc D38. Depends on L.A1.4 (schema lane order only).
>
> 1. `044_league_weeks.sql`: table per §12.17 verbatim (status default 'upcoming', median_score NUMERIC(8,2), waivers/finalized/reopened columns, `UNIQUE(league_id, season, week)`) + member-SELECT policy + **no write policies** (populated by M4's schedule/`league-week-advance` machinery; banner says so).
> 2. pgTAP 009: §4.2 pattern (member read scoping; all writes denied per role incl. RETURNING-count).
> 3. Typegen + alias (`LeagueWeek`).
>
> DoD: §4 standing rules; D38 realtime waiver cited in banner.

### L.A1.6 — Settings contract: Zod catalog + validation + split/merge (pure TS)
> Read spec §7.3 in full (every table), §7.3.2 (canonical JSONB + DL preset + swap display rule), §7.3.8 (validation rules), §12.1 (column/blob split), this doc §5. No DB dependency — parallel with the schema lane.
>
> 1. `src/lib/leagues/settings/`: `leagueSettingsSchema`, `rosterSettingsSchema`, `LEAGUE_SETTINGS_DEFAULTS`, `DL_PRESET`, `validateLeagueSettings`, `splitSettings`/`mergeSettings` per §5 sketch. Every §7.3.1/7.3.4–7.3.8 field with the spec's exact D/R values; tiebreaker chain default per §7.3.7; draft block per §7.3.8's table (pick_timer_seconds enum incl. 0).
> 2. Every §7.3.8 validation bullet implemented with a per-field message: team_count set; playoff-week arithmetic (`playoff_start_week + rounds×weeks_per_round − 1 ≤ 18`); starting-slot sum 1–20; unique slot keys; flex ≥2 eligible / single =1; bench 0–20; IR 0–6 each typed with ≥1 designation, restricted min_weeks ≥1; auction solvency floor (`auction_budget ≥ roster_size × auction_min_bid`); roster_size × team_count ≤ draftable-pool warn. *(§7.3.8's "exactly one scoring system referenced and readable" bullet is deliberately NOT here — it needs a DB lookup, so it's enforced in-body by the L.A1.12/L.A1.13 RPC path per the v1 templates-only rule, §7.3.3.)*
> 3. Tests (falsifiability floor): defaults validate clean (golden-pinned serialization of the full default object — the roster portion is the same JSON literal 040's pgTAP default test pins, and L.A1.13's integration suite asserts a freshly-defaulted leagues row's roster_settings deep-equals it); every range boundary at edge and one past; one violating fixture per §7.3.8 bullet; `mergeSettings(splitSettings(x)) ≡ x` property test. **The round-trip enumeration fixture = every leagueSettingsSchema field (§7.3.1/7.3.4–7.3.8) + rosterSettingsSchema (§7.3.2) + `scoring_system_id` (§7.3.3's template choice — a §12.1 typed column carried alongside splitSettings' output, not inside it)** — the same fixture the L.A1.13 API round-trip drives, so gate item 3's "every §7.3 field" is literally this list.
>
> DoD: plan §2.3 + §4.3; deliberate-break probe (flip one default) fails the golden pin.

### L.A1.7 — Migration 057 *(was 045)* + registry completion: def_ya seeding (Q3), box-score columns (D41), adapter re-check
> Read PROGRESS Q3 resolution, spec §23.5, App B.4, this doc D41/D44, M0 decisions D5/D20–D22. Schema lane, after L.A1.5. **Needs web access** (ESPN published scoring table) and the checked-in 2025-wk2 fixture.
>
> 1. **Verify ESPN's split-D/ST bucket boundaries** from ESPN's official published table (record URL + retrieved values in the PR — App B's "re-verify at build time" rule). Seed `def_ya_<lo>_<hi>` keys on those exact buckets (D21 convention, Q3 approval) + a `def_yards_allowed` raw ingestion key. Registry golden-pin test updated (full key list as literals — R23 pattern).
> 2. `045_player_stats_box_columns.sql`: additive columns for deferred core_box keys that will ever be column-stored (per-type `pass_2pt/rush_2pt/rec_2pt` per D20; `fg_0_39`, `fg_missed`, `pat_missed`, `def_block`, `def_return_td`, `fumble_recovery_td`, `return_td`, `def_yards_allowed` — final list from the registry audit), flip their registry `storage` to `'column'`. `def_pa_*`/`def_ya_*` tier keys stay **derived-at-scoring-time** (D44) — never stored.
> 3. Adapter completeness re-check (D5/D22 checkpoint): audit every registry core_box key against the real 2025-wk2 fixture + live-stats repo evidence; add Sleeper mappings **only with evidence**; keys without evidence stay deferred, each with a one-line note. The 2-pt writer-side summing continues (byte-identical) alongside the new per-type columns. `xpmiss` (R10) stays flagged for the September re-check.
> 4. Ingestion-continuity tests updated: upsert-surface pin extends to the new columns; existing M0 gate (`test:gate`) must stay green untouched — if it doesn't, stop (that's a behavior change, not continuity).
>
> DoD: §4 standing rules; probe: remove one seeded def_ya key → registry golden pin fails (shown, reverted). **No pgTAP file for 045 — citable waiver:** additive columns on an already-tested table, no policy/constraint changes; coverage is L.A1.7's registry golden pins + the upsert-surface vitest continuity (consistent with plan §2.3's "pgTAP tests for policies/constraints" scoping). Migration banner cites this waiver.

### L.A1.8 — Generic dot-product calculator + tier derivation (pure TS)
> Read spec §7.3.3 (contract + precision + extensibility), §23.5 (pending semantics, E61), this doc D33/D44. Depends on L.A1.7's registry (imports key metadata for derivation only — the calculator itself is key-agnostic).
>
> 1. `src/lib/leagues/scoring/calculator.ts` per §5: Σ rules[key]×stat(key); unknown rules keys → `pending[]` (never 0 in the breakdown; totals include only delivered keys); stat keys without rules ignored; full-precision accumulate → half-up 2-decimal total. `derive-stats.ts`: one-hot `def_pa_*`/`def_ya_*` from raw values (boundary instants: PA=0, 1, 6, 7 … 35; YA at every ESPN bucket edge).
> 2. Tests: property test (random rules/stats: total ≡ independent recompute; adding an undelivered rules key never changes total but appears in pending); golden pins for hand-built lines; rounding pins at the half-up boundary (e.g. .005); E38 two-decimal tie case; deliberate-break probe (flip half-up to bankers') fails the rounding pin.
> 3. **No import from `src/lib/scoring/default.ts`** — one namespace, no translation (D33); lint/test asserts the calculator module has no legacy-namespace literals.
>
> DoD: plan §2.3 + §4.3.

### L.A1.9 — Migration 058 *(was 046)*: is_template + the 6 parity template rows
> Read spec §7.3.3, Appendix B.1/B.4 (+ the ⚠ re-verify rule), App A.2, this doc D34/D44. Schema lane, after L.A1.7. **Needs web access** (ESPN/Yahoo/Sleeper official help pages).
>
> 1. **Re-verify every Appendix B cell** against each platform's current official help pages (K distance tiers, D/ST tables, INT −2 vs −1, fumble values); record per-cell evidence (URL + value) in the PR. Divergences from App B: stop and file a spec question (parity guarantee is the product promise — never silently ship drifted values).
> 2. Author the 6 rules objects in code (`src/lib/leagues/scoring/templates.ts`) under **canonical registry keys only** (ESPN templates carry `def_pa_*` + `def_ya_*`; Yahoo/Sleeper `def_pa_*`; kicking buckets; per-type 2-pt) with a registry cross-check test (every rules key exists in STAT_KEYS — one namespace, mechanically enforced).
> 3. `046_scoring_templates.sql`: `ALTER TABLE scoring_systems ADD COLUMN is_template BOOLEAN NOT NULL DEFAULT FALSE;` + "Templates viewable by everyone" SELECT policy (`is_template = TRUE`) + idempotent seed of the 6 rows (`owner_id NULL`, `is_template TRUE`, names per §7.3.3's table, rules = the authored objects, `ON CONFLICT` guard keyed on a stable natural key — e.g. a unique partial index on name WHERE is_template).
> 4. pgTAP 010: 6 rows present with pinned names; world-readable incl. anon; client INSERT/UPDATE/DELETE denied on template rows per role (RETURNING-count; owner-scoped policies can't reach owner_id NULL rows — asserted).
> 5. **TS↔DB equivalence link (mechanical, not honor-system):** an integration test against the local stack SELECTs each of the 6 template rows and deep-equals `row.rules` against the corresponding `templates.ts` export (values, not just keys) — so the rules the parity gate tests (L.A1.10, in TS) are provably the rules production snapshots (in the DB). Joins the L.A1.16 gate suite.
> 6. Typegen + alias (`ScoringSystem` update).
>
> DoD: §4 standing rules; probe: mutate one seeded coefficient in the migration → the TS↔DB equivalence test AND pgTAP's rules golden pin both fail (shown, reverted).

### L.A1.10 — Template parity fixtures + tests (the gate's item 4)
> Read spec §7.3.3 (parity guarantee, precision), App B, §19.2 E38/E61, this doc D44. Depends on L.A1.8 + L.A1.9 (authored rules).
>
> 1. Five canonical player-weeks (fixtures as literals, hand-computed): a QB week (incl. INT + 2-pt + sack context), an RB week (fumble, 100-yd bonus absence check), a WR/TE week (receptions differentiating Std/Half/Full PPR), a K week (a make in each distance bucket + a miss + PAT miss), a D/ST week (exercising a PA tier AND a YA tier so ESPN split ≠ Yahoo/Sleeper single visibly).
> 2. For each of the 6 templates × 5 weeks: `scorePlayerWeek(template.rules, derive(stats))` ≡ the hand-computed literal, to the cent. Cross-platform assertions: ESPN INT −2 vs Yahoo/Sleeper −1 produces the pinned delta; PPR variants differ by exactly receptions × coefficient.
> 3. Deliberate-break probe: nudge one B.1 coefficient in the authored rules → the affected pins fail (shown, reverted).
>
> DoD: plan §2.3 + §4.3; these tests join the M1 gate suite (L.A1.16).

### L.A1.11 — Migration 059 *(was 047)*: snapshot RPC + lifecycle guard (the gate's item 2)
> Read spec §7.3.3 (snapshot), §7.3.8 (final validation bullet), §7.1 (status machine), this doc D43. Schema lane, after L.A1.9.
>
> 1. `047_scoring_snapshot.sql`: `snapshot_league_scoring(p_league_id)` — SECURITY DEFINER `SET search_path=''`, in-body commish check, copies the league's `scoring_systems.rules` into `scoring_rules_snapshot` (REVOKE PUBLIC/anon); `set_league_status(p_league_id, p_status)` — validates §7.1 transitions available in M1 (`setup ↔ scheduled`; anything → `drafting`+ is refused in M1 with "draft engine lands in M2" *except* via the M2 draft_start path to come); BEFORE UPDATE trigger on leagues: any transition into `drafting/in_season/playoffs/complete` with `scoring_rules_snapshot IS NULL` raises (D43).
> 2. `scheduled` requires — **checked in-body, SQL-native only**: legal §7.1 transition + commish auth + `settings->>'draft_scheduled_at'` present. Full §7.3.8 settings validation is NOT re-implemented in SQL: it runs server-side in the lifecycle Route Handler via `validateLeagueSettings` (L.A1.13 is the named enforcement point for settings validity) per §7.3.8's "enforced in API + DB constraints" split; the DB-level backstops are 040's CHECK constraints and the D43 snapshot trigger. Any §7.3.8 bullet that must *additionally* be DB-enforced gets named individually as an explicit SQL reimplementation with a parity test against the TS validator — none is in M1 scope.
> 3. pgTAP 011: trigger raises on a forced `setup → drafting` UPDATE without snapshot (service-role direct UPDATE — proving the guard catches even privileged paths); succeeds with snapshot; snapshot RPC denied to non-commish; boundary: re-snapshot overwrites (scoring change pre-draft re-freezes).
> 4. Integration test (local stack): create → schedule → force-transition probe.
>
> DoD: §4 standing rules; probe: disable the trigger → the pgTAP force-transition test fails (shown, reverted).

### L.A1.12 — create_league RPC + league CRUD routes + hooks
> Read spec §15.1, §7.2 (create requirements), §7.3.3 (v1 templates-only rule) + §7.3.8 (scoring-reference bullet), §12.1–12.2, §17, this doc §5, CLAUDE.md (API route pattern, React Query pattern). Depends on L.A1.2 + L.A1.3 + L.A1.9 (template rows — the in-body check and representative tests need them) + L.A1.6 (schemas).
>
> 1. `create_league` RPC per the §5 sketch (single txn: league + member (faab_balance seeded from faab_budget, §12.2) + team + stint + invite_code; max_teams sync; **no is_pro gate — Q6 ruling 2026-07-20, v2.8: creation is free**; **in-body: `p_scoring_system_id` must reference a `scoring_systems` row with `is_template = TRUE AND owner_id IS NULL`** — v1 templates-only (§7.3.3), friendly per-field error otherwise).
> 2. Routes: `POST /api/leagues` (auth → Zod parse via L.A1.6 → validateLeagueSettings → RPC — **no requireProUser: creation is free, Q6/v2.8**), `GET /api/leagues` (my leagues via league_members), `GET /api/leagues/[id]` (detail: settings + members + teams + my role), `DELETE /api/leagues/[id]` (soft delete, commish). kebab-case, Zod, §12.0 layering.
> 3. Hooks: `use-leagues.ts`, `use-league.ts` (React Query per CLAUDE.md pattern).
> 4. Integration tests (local stack): create at every team_count (8..16 — the Phase A gate sizes); creator seated as commissioner with team + open stint (stint asserted directly; `faab_balance = faab_budget` asserted); **a free (non-Pro) user creates successfully** *(Q6 ruling 2026-07-20 — DoD changed: the former non-Pro 402 `PRO_REQUIRED` test is deleted)*; **negative: a personal (owner-scoped, non-template) scoring_systems id → rejected, no league row written**; invalid settings 400 with the per-field message; idempotency-safe double-submit (natural key or action_id — client retries must not create two leagues).
>
> **Pre-authorized fallback split (sizing; L.A0.3 precedent):** if fix-cycle 3 is reached, land the RPC + POST/GET routes + core tests as this task and open "L.A1.12b — detail route, DELETE, hooks, remaining tests" immediately — a sanctioned exit, not a stop-and-wait.
>
> DoD: plan §2.3 + §4 standing rules (RPC form, REVOKE, held-lock <50ms assertion).

### L.A1.13 — Settings PATCH + lifecycle route + the full §7.3 round-trip (gate item 3)
> Read spec §7.3 (all), §7.1, §15.1 PATCH semantics, this doc L.A1.6/L.A1.11. Depends on L.A1.6 + L.A1.11 + L.A1.12.
>
> 1. `PATCH /api/leagues/[id]`: commish-only; Zod + validateLeagueSettings; splitSettings writes columns + blob atomically; **any write that changes `team_count` also writes `max_teams = team_count` in the same statement** (§12.1 NOTE — create_league is the first writer, this is the second); **`scoring_system_id` changes apply the same `is_template = TRUE AND owner_id IS NULL` in-body check as create** (v1, §7.3.3); **structural settings editable only in `setup`/`scheduled`** (§7.3 header — the post-draft override path is M6; M1 returns a clear 409); status transitions via `set_league_status` (L.A1.11).
> 2. **Round-trip suite (gate item 3):** for EVERY field in the L.A1.6 enumeration (leagueSettingsSchema + rosterSettingsSchema + `scoring_system_id`) — drive PATCH with a non-default in-range value, GET back, assert equality against the fixture (golden). Includes: PATCH to a different template id → GET back equal, and the rejected non-template-id case; after the team_count PATCH, a direct DB read asserts `max_teams = team_count` (the GET path doesn't expose max_teams). Boundary values for every ranged field; a rejected out-of-range case per field group.
> 3. Reach-`scheduled` integration: valid settings + draft_scheduled_at → `scheduled`; missing either → clear 400/409; back to `setup` works. **This route is the enforcement point for settings validity on the `scheduled` transition** (L.A1.11's `set_league_status` enforces transition legality + draft_scheduled_at; the D43 trigger enforces the snapshot invariant).
>
> DoD: plan §2.3 + §4.3; probe: silently drop one field from splitSettings → round-trip suite fails on exactly that field (shown, reverted).

### L.A1.14 — Invites: create/revoke/slug/join/claim RPCs + routes + email seam
> Read spec §7.2 (all four invite paths, E53/E54/E65), §12.23, §16.4 (identity display rule), this doc D36/D37/§5. Depends on L.A1.4 + L.A1.12.
>
> 1. RPCs: `create_league_invite` (seat-targeted by email/username/open link; general multi-use link; commish-only in-body), `revoke_league_invite`, `rotate_invite_code(p_league_id)` (commish-only in-body; regenerates `leagues.invite_code`, leaves `invite_slug` untouched — §7.2 "rotatable", §15.1, §22.5), `get_join_preview(p_value)` (**pre-auth**: deliberate anon EXECUTE carve-out; resolves **seat token → invite_code → invite_slug** (CITEXT, case-insensitive) per §16.1's claim route contract; returns ONLY league name + team label/seats-open + inviter display name where applicable — §12.23 as amended by D48), `claim_league_invite` per the §5 sketch, `join_league_by_code(p_code_or_slug)` (free — NO Pro gate; C1: spec wins over CLAUDE.md rule 5; **at capacity → friendly "league is full" rejection, D47**).
> 2. Routes per §15.1: `POST/DELETE /api/leagues/[id]/invites`, `POST /api/leagues/[id]/invite` (rotate/refresh the share code — §15.1), `PATCH /api/leagues/[id]/slug`, `POST /api/leagues/join`, `POST /api/invites/claim`. Join/claim seat the user: league_members + teams attach (**team auto-created only while open seats remain**, §7.2/D47) + **open stint**; `faab_balance` seeded from `faab_budget` (§12.2).
> 3. Email seam (D37; **Q5 ruling 2026-07-20: interface only, NO vendor binding** — vendor selection waits until invite-send mail is ready to ship): `EmailSender` interface + dev implementation; invite email = league name, team label, claim link `/join/[token]`; send recorded on the invite row (`created_at` = initial send, `last_sent_at` on re-send — D46). In-app notification for username invites (existing notifications infra, new `league_invite` type).
> 4. Tests: E53 mismatch (wrong signed-in email/username → friendly rejection, invite intact); E54 double-claim race → one-open-stint 23505 mapped to "seat already filled", invite expired, commish notified; E65 email-locked matching (JWT email claim, case-insensitive); expiry boundary (claim at exactly `expires_at` and 1s past); revoked; use_count/max_uses edge; **rotation: old code stops joining, new code joins, custom slug still resolves**; **capacity boundary: join with one seat open creates the team_count-th team; join on a full league (multi-use link, max_uses not exhausted) creates NO teams row and returns "league is full"; teams count stays ≤ team_count**; join-by-code creates team + stint; a `get_join_preview` case per resolution type + unknown-value; **free user joins two leagues** (C3/C4 regression — the 018 cap must not fire).
>
> **Pre-authorized fallback split (sizing; L.A0.3 precedent):** if fix-cycle 3 is reached, land the RPCs + routes + the E53/E54/E65 core tests as this task and open "L.A1.14b — D37 email seam + league_invite notification + remaining test-matrix items" immediately — a sanctioned exit, not a stop-and-wait. L.A2.5/L.A2.6 depend only on the RPC/route surface, so the split leaves the §6 graph intact (invite creation records send-intent on the row; the sender wires in L.A1.14b).
>
> DoD: plan §2.3 + §4 standing rules; probe: remove the invited_email check → E53 test fails (shown, reverted).

### L.A1.15 — Member management: roles, placeholder seats, assign/remove (modes), leave
> Read spec §7.2 (roles/kick/capacity), §7.2.1 + D42 (pre-draft semantics), §12.22, §15.1, §17. Depends on L.A1.3 + L.A1.12.
>
> 1. RPCs: `add_placeholder_seat` (teams row owned by commish + league_members row user_id NULL is_placeholder — capacity-capped at team_count), `set_member_role` (promote/demote co_commissioner; exactly-one-commissioner invariant; creator never removable by a co-commish), `assign_manager` (seat a user on a franchise → open stint; §15.1), `remove_manager(p_mode)` with the full three-outcome signature, pre-draft semantics per D42 (takeover → seat swap/reseat via invite; vacate → seat reverts to placeholder; retire → friendly "not available before the draft"); `leave_league` (`end_reason='left'`; commissioner must transfer role first). **Every league_members insert here (placeholder, assign) seeds `faab_balance` from `faab_budget` (§12.2) so all seats match the create/join/claim paths.**
> 2. Routes per §15.1 (`POST /api/leagues/[id]/members`, `PATCH/DELETE .../members/[mid]`, `POST .../teams/[tid]/assign-manager`). *(No `is_autodraft` handling: the column shipped in 052 per §12.2 verbatim, but the §15.1 members-PATCH autodraft toggle has no consumer before a draft exists — deferred to M2 with the draft engine, see §11; M1's PATCH rejects it with a clear message.)* Every stint close/open inside the same txn as the league_members cache update (§12.2 note).
> 3. Tests: stint history integrity (remove → re-invite same user → two rows, no merge — E51 pre-draft analogue); access-derives-from-open-stint (removed member's league_members row gone/closed → member-scoped SELECTs return nothing — E50 analogue at M1 scope); role invariants (second commissioner rejected; co-commish cannot remove creator); capacity boundary (seat team_count+1 rejected).
>
> DoD: plan §2.3 + §4 standing rules.

### L.A2.1 — Create wizard (replace the scaffold)
> Read spec §16.2 (league-create-wizard), §7.3 (wizard steps), §16.5.1 setup row, CLAUDE.md redesign rules (re-skin in place; Field Scout look). Depends on L.A1.12/L.A1.13 (+ L.A2.2/L.A2.3 slots — stub their steps until those land).
>
> 1. Rebuild `league-create-scaffold.tsx` → `league-create-wizard.tsx` per §16.2: format → roster (slot builder step) → scoring (template step) → waivers/trades → draft → invite; defaults pre-filled from `LEAGUE_SETTINGS_DEFAULTS` so the happy path is <2 min (§7.3 goal); per-step validation via `validateLeagueSettings` field errors; submit → POST /api/leagues → navigate to the real league.
> 2. Keep the `featureFlags.leagues` gate — **no Pro gate** *(Q6 ruling 2026-07-20 — DoD changed: the scaffold's Pro upsell goes away; creation is free)*; mock-data imports removed from this path.
> 3. States per §16.5.4: submit-pending, per-field error.
>
> DoD: plan §2.3 (Design Reviewer coverage per §16.5); verified in the browser (D39) with screenshots in the session log.

### L.A2.2 — roster-slot-builder (custom flex, per-spot IR, DL preset, Hot Swap)
> Read spec §7.3.2 in full (slot model, IR rules, DL preset, swap display order), §16.2 (roster-slot-builder line), §16.4 (naming: DL + Hot Swap are product promises). Depends on L.A1.6.
>
> 1. `roster-slot-builder.tsx`: per-position starter counts (0–10); "Add Custom Flex" (position multi-select ≥2, commissioner-named label, unique key generation); multiple distinct flexes; bench 0–20; IR spots 0–6 each configured Unrestricted/Restricted + eligible designations + min_weeks (Restricted), **one-tap "DL" preset** (OUT/IR/Doubtful, 4 weeks); **"Hot Swap" toggle** (`swap_spots` 0/1 — all UI copy says Hot Swap, §16.4); live derived roster_size + §7.3.8 violations rendered inline; display order: Hot Swap below flex/superflex, above K/D-ST/IR (§7.3.2).
> 2. Emits/accepts the §7.3.2 canonical JSONB via `rosterSettingsSchema` — golden-pin a builder-output fixture for the spec's two-flex printed example against the canonical example JSONB (shape fidelity — that fixture is NOT the default; the default is the preset-table counts per L.A1.1).
> 3. Used by both the wizard step and the settings panel (no duplicate component — CLAUDE.md).
>
> DoD: plan §2.3; states per §16.5.4; browser-verified.

### L.A2.3 — scoring-template-picker (6 parity cards + compare)
> Read spec §7.3.3 (v2.7: 6 cards, no editor, no teaser cards, no "three ways" widget), §16.2, App B. Depends on L.A1.9.
>
> 1. `scoring-template-picker.tsx`: 6 cards (name + one-liner per §7.3.3's table) reading real template rows (`is_template = TRUE`); side-by-side compare of key category values (PPR, INT, kicking, D/ST model); selection writes `scoring_system_id`.
> 2. Explicitly ABSENT (spec v2.7 + §16.5.5): custom editor, Alpha/Ultra cards, the "same game, scored three ways" widget — do not build placeholders for them.
> 3. Wizard step + settings panel reuse.
>
> DoD: plan §2.3; browser-verified.

### L.A2.4 — Settings panel + manage view wiring
> Read spec §16.2 (settings-panel), §7.3 (grouping), §7.1 (edit-lock by status), §17. Depends on L.A1.13 **+ L.A2.2 + L.A2.3** (the panel embeds both components — do not stub; step 3's per-group round-trip requires them).
>
> 1. `settings-panel.tsx`: grouped, validated forms over the full catalog (format/structure, roster via L.A2.2, scoring via L.A2.3, waivers & FA, trades, lineups & lock, tiebreakers reorder, draft config); commish-only editing; structural-lock messaging once past `scheduled` (M1 shows the 409 state; the override path is M6).
> 2. Wire `league-manage-view.tsx`'s stubbed summaries to real data; "League settings" links stop pointing at `/app/settings/scoring` (C-note: that's the personal research scoring page).
> 3. Round-trip sanity in the browser: change a field in each group, observe persistence.
>
> DoD: plan §2.3; §16.5.4 states; browser-verified.

### L.A2.5 — Invite panel + seat list
> Read spec §7.2 (email-first), §16.2 (invite-panel line), §16.4 (identity display rule, invite funnel), E53–E54/E65 states. Depends on L.A1.14 + L.A1.15.
>
> 1. `invite-panel.tsx`: league share link — **always visible and copyable by the league manager (the Q5 v1 minimum bar: they can paste it into any email/text themselves, vendor or no vendor)** — + custom slug editor + **"rotate link" affordance** (confirm dialog — it invalidates the shared code; §7.2/§22.5, wired to `rotate_invite_code`); seat list (n/N, per-seat status: open/invited/claimed/placeholder) with **email-first** seat-targeted invite affordance (username + copyable-link secondary); invite status + revoke; placeholder seat creation; roles UI (promote/demote); remove-manager entry with the D42 pre-draft chooser (takeover/vacate; retire disabled with the "after draft" note).
> 2. Identity rendering everywhere: *Team name — display name (@username)*; **email never rendered** for claimed seats (§7.2 — invited_email is commish-visible on pending invites only, per §12.23 RLS).
> 3. Replace `league-manage-view.tsx`'s inviteStub/removeStub.
>
> DoD: plan §2.3; §16.5.2 invite-workflow states covered; browser-verified.

### L.A2.6 — /join/[token] claim page + claim states
> Read spec §16.1 (`/join/[token]` — repo path `src/app/join/[token]/`), §16.2 (claim-invite-card), §16.5.2 invite/claim row, E53/E54/E65. Depends on L.A1.14.
>
> 1. Pre-auth claim page: `get_join_preview` resolves the param as **seat token → invite_code → invite_slug** (§16.1: the route serves all three link forms) → seat token renders the claim card (league, team label, inviter); code/slug renders a join card wired to `join_league_by_code`; signed-out → sign-in/sign-up handoff with the **email field pre-filled and locked** to `invited_email` for fresh signups (E65); signed-in → claim → seated → land on league home.
> 2. States: success · username/email mismatch (E53, friendly, invite intact) · seat already filled (E54) · league full (D47) · expired/revoked · **unknown token/code/slug**. Join-by-code entry point (leagues index "Join league" replaces its stub, routing through the same preview).
> 3. This route sits OUTSIDE the `featureFlags.leagues` gate's layout — apply the same flag check explicitly (invitees hit this cold).
>
> DoD: plan §2.3; §16.5.2 states; browser-verified.

### L.A2.7 — League home states (setup/scheduled) + index wiring
> Read spec §16.5.1 (setup + scheduled rows only), §16.2 (league-home-states), §16.4 (timezones). Depends on L.A1.12/L.A1.13 (+ L.A2.5 for invite affordances).
>
> 1. `league-home-states.tsx` for M1's two statuses: `setup` → checklist hero (settings ✓ · seats n/N with per-empty-seat invite affordance · template chosen · schedule draft) ; `scheduled` → draft countdown (league TZ + viewer-local per §16.4; "Enter draft lobby"/"Practice this draft" CTAs stubbed → M2). Later statuses render a clearly-marked not-yet state, never mock data.
> 2. Wire `leagues-index.tsx` to real memberships (my leagues via `use-leagues`); keep mock fixtures ONLY behind clearly-dead demo paths or delete them where replaced (league-mock-data.ts shrinks; draft mocks untouched — M2).
> 3. Skeleton/empty/error per §16.5.4.
>
> DoD: plan §2.3; browser-verified.

### L.A1.16 — M1 gate harness (exit-criteria proof)
> Read this doc §1 + §8, delivery plan §3 M1 row, D39. Depends on everything above.
>
> 1. Gate suite runnable as `npm run test:gate:m1` (vitest tag/dir + a `test:db` run): (a) **Phase A journey** at the integration level — create at 8/10/12/14/16 → full configure (round-trip suite, L.A1.13) → invite (email seat + username + link) → claim/seat all → placeholder fill → `scheduled`; includes the **negative templates-only probe** (personal scoring-system id rejected at create AND at PATCH); (b) **snapshot guarantee** — the L.A1.11 force-transition probes; (c) **parity suite** (L.A1.10) green **+ the L.A1.9(5) TS↔DB template-rules equivalence check**; (d) full pgTAP suite green (005 through the highest-numbered M1 file — 012+ after the review-fix files took 008/011); (e) M0 gate (`test:gate`) still green (continuity).
> 2. Browser pass over the M1 UI slice (wizard end-to-end, invite panel, claim page, home states) — screenshots into the session log (D39 waiver: Playwright E2E lands M2).
> 3. Update PROGRESS: §1 M1 status, §2 checkboxes, session-log entry with the gate output pasted.
>
> DoD: all §1 exit criteria shown green in one session log.

---

## 7. Migration plan (schema lane, serialized; numbering corrected 2026-07-20 — L.A1.2 session)

| # | File | Contents | Task |
|---|---|---|---|
| 040 | `040_leagues_settings_columns.sql` | citext ext; §12.1 ALTER verbatim; canonical roster_settings default | L.A1.1 |
| 049 | `049_handle_new_user_username_contract.sql` | Q7.1 critical fix (L.A1.1 review): signup metadata honored only when human-pattern — an anonymous signup could otherwise mint a `*-ai` handle (trigger context has `auth.role()` NULL, bypassing 040's guard). Post-dates 048 because 048 re-creates `handle_new_user` | L.A1.1 |
| 050 | `050_reserve_placeholder_username_shape.sql` | R32 (L.A1.1 review): `user_<8hex>` placeholder shape reserved (CHECK carve-out + guard extension + metadata exclusion); R35 persona 32-char cap | L.A1.1 |
| 051 | `051_handle_new_user_display_name_fallback.sql` | R31 (L.A1.1 review): `display_name` derives from `effective_username` — rejected metadata never propagates | L.A1.1 |
| 052 | `052_league_members_and_helpers.sql` | §12.2 table; §12.0 helpers (search_path='' hardening); §12.1 policy swap *(was reserved as 041; renumbered at task time — the chain moved past the reservation via 048–051)* | L.A1.2 |
| 053 | `053_team_franchises.sql` *(was 042)* | §12.22 teams ALTER + `list_id` DROP NOT NULL (D35a); teams RLS replacement (D35b); `team_managers` | L.A1.3 |
| 054 | `054_league_server_authoritative.sql` | Q8 ruling / M1 batch-2 review fixes (R37–R40, R43): leagues owner FOR ALL dropped; league_members commish FOR ALL → placeholder-seat INSERT/DELETE (no client UPDATE); teams status + not-self-successor CHECKs; R39 FK indexes | batch-2 remediation |
| 055 | `055_league_invites.sql` *(was 043, then 054)* | §12.23 (+ D46 send-tracking columns): `invite_slug` + `league_invites` *(the D36 index moved to 040 per the Q4 ruling)* | L.A1.4 |
| 056 | `056_league_weeks.sql` *(was 044, then 055)* | §12.17 verbatim; no write policies | L.A1.5 |
| 057 | `057_player_stats_box_columns.sql` *(was 045, then 056)* | D41: additive box-score columns for deferred core_box keys; registry storage flips | L.A1.7 |
| 058 | `058_scoring_templates.sql` *(was 046, then 057)* | `is_template` column + template SELECT policy + 6 parity rows (idempotent seed) | L.A1.9 |
| 059 | `059_scoring_snapshot.sql` *(was 047, then 058)* | `snapshot_league_scoring` + `set_league_status` RPCs + D43 lifecycle guard trigger | L.A1.11 |
| 060 | `060_create_league.sql` *(added 2026-07-25 — the API lane's first migration; not part of the original 040–047 reservation)* | `create_league` + `soft_delete_league` RPCs (Q8: the only league writers); `leagues.creation_action_id` UUID UNIQUE (idempotency key, D68) | L.A1.12 |

Every migration: banner citing spec §; §4 standing rules (grants doctrine, R6 rehearsal waiver, D38 realtime waiver where applicable); pgTAP in the same PR *(the 057 waiver recorded here was RETIRED 2026-07-20 by the batch-4 remediation — R52 falsified its coverage claim (nothing executable touched the 11 columns in the database) and pgTAP **011** now pins them; see the 057 banner + PROGRESS batch-4 resolution)*; typegen + alias-block re-append. M1 pgTAP files are **005–012+** (004 was taken same-day by the C15 chip; 008/011 by review-fix batches — confirm next free at task time); migrations **048** (C15 fix) and **049–051** (L.A1.1 review fixes) took the numbers directly after 040, so the remaining schema-lane tasks renumbered **052–059** (table above corrected 2026-07-20, L.A1.2 session; corrected again same day when the batch-2 review-fix migration took **054**, shifting L.A1.4–L.A1.11 to 055–059 — task-text mentions of 041–047 for pending migrations read through this table) — Builders confirm the next free numbers at task time. **Not in M1:** `drafts`/`draft_*` (M2), `league_lists` (M2, D32), `matchups`/`league_rosters`/`transactions`/`waiver_claims`/`trades`/`lineup_swaps`/`league_player_pool`/`team_week_results`/`stat_correction_events` (M4+), `commissioner_actions` (M6), `player_stats.advanced` JSONB (funded-advanced-stats milestone, D8).

---

## 8. Exit-criteria → proof map

| Exit criterion (§1) | Proven by |
|---|---|
| Phase A gate (create → configure → seat → `scheduled`, all 5 sizes) | L.A1.16(1a) integration journey on L.A1.12–15's real RPC/route path + browser pass (D39) |
| Snapshot present from draft start | D43 trigger + L.A1.11 pgTAP force-transition probes, re-run in L.A1.16(1b); M2's `draft_start` inherits the guarantee mechanically |
| Settings round-trip, every §7.3 field | L.A1.6 enumeration fixture driven through the real PATCH/GET path (L.A1.13), re-run in the gate |
| Template parity, 6 × 5 player-weeks to the cent | L.A1.10 golden fixtures over L.A1.8's calculator + L.A1.9's verified rules, with the seeded DB rows deep-equal-pinned to the TS-authored rules (L.A1.9(5), re-run in the gate) |
| ~~Alpha/Ultra backtest harness~~ | **Removed (D31)** — returns with funded advanced stats |

---

## 9. Conflict report (codebase / migrations 001–039 / docs vs the M1 spec sections)

*Verified during the 2026-07-20 survey; each item names its resolution. C-items with a task land in M1; doc items need Chris.*

| # | Conflict | Evidence | Resolution |
|---|---|---|---|
| **C1** | **CLAUDE.md Key Business Rule #5** says "Leagues are Pro only. Gate league creation **and joining**" — the spec says joining is **free** (stated 3×: §3.1.6, §7.2, §19.1) | CLAUDE.md rule 5; spec lines 60/169/1637 | **RESOLVED by the Q6 ruling (2026-07-20, v2.8): creation AND joining are free.** CLAUDE.md rule 5 rewritten this session; spec swept (§3.1/§7.2/§15.1/§17/§19.1/App C); L.A1.12/L.A2.1 de-Pro'd (DoD changes flagged in-task) |
| **C2** | **CLAUDE.md Redesign section** still says league/draft screens are "UI-only… do not invent API routes or schema" — stale since the epic was greenlit (M0 shipped schema; M1 ships routes) | CLAUDE.md Redesign bullets vs Active Builds | **Chris: update the bullet** (Q6). M1 proceeds per Active Builds |
| **C3** | `teams.list_id UUID NOT NULL REFERENCES lists` — league franchises can't exist without a backing list; §7.2 join/placeholder teams are unbuildable as-is | 001:496 | 053 *(was 042)* drops NOT NULL (D35a; spec erratum v2.7.1) |
| **C4** | `teams` is client-writable ("Users can manage own teams" FOR ALL) incl. `wins`/`losses`/`league_id` — violates server-authoritative (§8.1, CLAUDE.md Active Builds) the moment teams carry league state | 001:844–848 | 053 *(was 042)* replaces with owner-manage scoped `league_id IS NULL` (D35b; erratum v2.7.1) |
| **C5** | `profiles.username`: plain TEXT, no DB constraints, client regex **3–30 must-start-with-letter** vs §7.2 **citext 3–20 `[a-z0-9_]`**; and §7.2 says usernames are **changeable** (E52) while spec-auth-profiles.md says **permanent** | 001:18; username/page.tsx:13; spec §7.2 vs spec-auth-profiles:16/38 | **RULED (Q4, 2026-07-20, v2.8): 5–20, permanent, lower()-unique, no grandfathering — constraint moves into 040.** Application **halted on Q7**: the settings page ships a rename flow and persona `*-ai` handles (prod rows) violate the charset — neither surfaced by this report. See PROGRESS §3 Q7 |
| **C6** | §7.2's **primary** invite channel is email; the repo has **zero outbound-email capability** (no lib, no edge functions, SMTP commented out) | package.json; config.toml:233–236 | **RESOLVED by the Q5 ruling (2026-07-20, v2.8): no vendor now — seam only (D37 confirmed); v1 minimum bar = the join link always visible/copyable in the invite panel (L.A2.5); vendor chosen when invite mail is ready to ship** |
| **C7** | Spec names `scoring_systems.is_template`; table has only `is_system_default` (different meaning, in-use policy) | 001:181–190 | 046 adds `is_template` additively (D34) |
| **C8** | §7.3.3 requires a generic dot-product; the actual calculator (`src/lib/scoring/default.ts` — spec's `src/utils/calculate-fantasy-points.ts` path **does not exist**) is hardcoded 19-key, missing→0, 1-decimal, legacy namespace ≡ column names (10 divergences: `xp_made`/`pat_made`, `def_sacks`/`def_sack`, summed `two_point_conversions`, stacking `fg_made`…) | default.ts:8–153 | New calculator in `src/lib/leagues/scoring/` (D33); legacy surfaces untouched; spec path erratum v2.7.1 |
| **C9** | `leagues.roster_settings` DEFAULT is the legacy flat shape, not §7.3.2's `starting_slots[]` canonical JSONB | 001:482 | 040 replaces the default (spec erratum v2.7.1; no rows exist; verified at reset + noted for prod push) |
| **C10** | Spec §16.1 route paths use `src/app/(app)/leagues/...`; the repo's actual convention is `src/app/app/leagues/...` (and `/join` → `src/app/join/`) | src/app layout | Follow the repo; spec paths read as illustrative (cosmetic — no erratum needed) |
| **C11** | `league_chat` RLS is keyed off `teams.league_id` ownership — wrong membership model once `league_members` is truth (placeholders, co-commish) | 001:880–893 | Not M1 (chat is unused, no M1 surface). **M2's draft-chat task replaces these policies** — recorded so M2's Architect inherits it |
| **C12** | `team_lineups` is client-writable by the team owner + world-readable — incompatible with server-authoritative lineups when M4 reuses/extends it (§12.13) | 001:850–861 | Not M1. Recorded for **M4's Architect** (L.D1 must replace these policies) |
| **C13** | `spec-leagues-live-mode.md` contradicts the epic (join Pro-only; `commissioner_id` column; thin schema) and is formally superseded by spec §2.3 — but carries no banner saying so | spec-leagues-live-mode.md:18–20,65 | **Chris/doc task (Q6):** add a superseded banner pointing at spec-redraft-leagues.md |
| **C14** | CLAUDE.md Commands lists `npm run test:e2e` — still doesn't exist (known M0 §8 note; Playwright lands M2) | package.json scripts | Unchanged M0 disposition; D39 covers M1's gate |
| **C15** | Seven pre-017 SECURITY DEFINER functions set **no** `search_path` at all (`handle_new_user`, four counter triggers, `update_list_like_count`, `reorder_list_players`) — outside M1's surface but a real hardening gap the 037 grant model amplifies | 001:918–1010; 004:10–44; 006:17–53 | Not M1 (no league table touches them). Routed to the **M7 RLS/RPC security review**; flagged as a spawn-task chip this session. **RESOLVED 2026-07-20 (pulled forward per Chris):** migration `048_secdef_search_path.sql` (bodies verbatim + `public, pg_temp` pin) + pgTAP `004_secdef_search_path.sql` universal pin on every `public` SECURITY DEFINER function — D45 |
| **C16** | Draft mock fixtures internally inconsistent (draft-side MOCK_LEAGUE is 10-team; leagues-side "The Work League" is 12-team; every leagueId gets the same fixture) | mock-draft.ts:71–77 vs league-mock-data.ts:203–217 | M2 concern (draft room wiring); recorded for M2's Architect |
| **C17** | `profiles` has no email column — E65/E53 email matching cannot read profiles | 001:16–31 | Design note, not a change: claim RPC matches `invited_email` against the auth record (JWT email claim), per L.A1.14. Email stays league-invisible (§7.2) |
| **C18** | §7.2 requires "every send/claim/revoke is recorded", but §12.23's printed `league_invites` DDL has no `created_at` and no send timestamp | spec §7.2 vs §12.23 DDL | **D46**: 043 adds `created_at` + `last_sent_at` additively; spec erratum v2.7.1 |

---

## 10. M0-thread dispositions (each thread the M0 close-out routed to M1)

| Thread | Disposition |
|---|---|
| **Q3 — `def_ya_<lo>_<hi>` seeding** (approved 2026-07-19, unseeded) | **Task L.A1.7**: keys seeded on ESPN's published bucket boundaries (verified with recorded evidence); consumed by L.A1.9 templates + L.A1.10 parity fixtures; spec-changelog note folds in when the keys land (per the Q3 resolution text) |
| **D18/D23 grants doctrine** | **Standing rule §4.1** for every M1 table/RPC; REVOKE discipline per 038 precedent; pre-auth claim preview is the one documented anon carve-out |
| **No-write-policy RLS test pattern** (003_nfl_weeks RETURNING-count) | **Standing rule §4.2** — every new-table pgTAP (005–011) uses it |
| **D24 — source-semantics seam** | **D40**: M1 ingests nothing; lands with M4's first synthetic/fixture ingestion into a real DB. Explicitly handed to M4's Architect |
| **Falsifiability floor** (golden pins, boundary instants, deliberate-break probes) | **Standing rule §4.3** — the M1 test standard, cited in every test-shipping task's DoD; UI tasks per §4.3's scoping sentence |
| **RPC convention divergence** (M0 §8: repo uses `public, pg_temp`) | **Standing rule §4.1**: every M1 RPC/function uses `SET search_path = ''`; L.A1.2's helpers are the first instances |
| **D5 — deferred-key storage mapping "is M1 work"** + adapter completeness re-check | **Task L.A1.7 / migration 045** (D41), evidence-gated against the real 2025-wk2 fixture |
| **D22/R10 — `xpmiss` mapping unverified** | Stays open until the first real 2026 actuals recording (September ops note); not an M1 blocker |
| **D20 — per-type 2-pt storage "is M1 work"** | **Task L.A1.7 / migration 045**; writer-side summing to `two_point_conversions` preserved byte-identical alongside |
| **§7.3.3 capability gating "starts M1"** (D5 note) | Template-picker gating is trivially satisfied in v1 (all 6 templates are core_box); the "coming soon" gating UI ships with the Alpha/Ultra cards when funded. Adapter-side capability truth re-verified in L.A1.7 |

---

## 11. Known gaps & notes for later milestones (not M1 work)

- **M2 inherits:** league_chat policy replacement (C11); draft mock-fixture reconciliation (C16); Playwright bootstrap + Phase A E2E (D39); broadcast triggers + `realtime.messages` channel auth for M1's tables (D38); `league_lists` + attach UI (D32); Phase A's "Practice this draft" entry (mock drafts, §8.8); the §15.1 commissioner autodraft toggle on `PATCH /api/leagues/[id]/members/[mid]` (the `is_autodraft` column shipped in 052 per §12.2 verbatim, but the toggle has no consumer until the draft engine, which also owns the member self-service `POST .../draft/autodraft` per §15.2).
- **M4 inherits:** D24/D40 source semantics on first real ingestion; `team_lineups` RLS replacement (C12); `league_weeks` population + `league-week-advance`; §7.2.1 in-season consequence machinery (D42) incl. retire-&-succeed and orphan/autopilot; `nfl_games` population via the nflverse adapter (D16 — first runtime consumer of kickoffs is M4's locks).
- **M6 inherits:** structural-settings override path (M1 returns 409 past `scheduled`); `commissioner_actions` + audit wiring for every override-shaped action M1 stubs.
- **M7 inherits:** ~~C15 (search_path-less SECURITY DEFINER functions)~~ *(resolved 2026-07-20 — pulled forward, migration 048 + universal pgTAP pin, D45)*; §22.5 rate limits on invites/joins; R19's TRUNCATE narrowing revisit.
- **September ops (unchanged from M0):** live 2026 fixture recording; M0 gate re-run on first real week; `xpmiss` verification (D22/R10).
- **Chris (PROGRESS §3):** ~~Q4–Q7~~ **all ruled 2026-07-20** (recorded in spec v2.8/v2.8.1 + this doc). Still his: C2 (stale CLAUDE.md redesign bullet) and C13 (spec-leagues-live-mode superseded banner).
