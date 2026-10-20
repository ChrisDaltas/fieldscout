# §22.6 load harness (M7 L.F2.1)

The four §22.6 scenarios as k6 scripts, the seeder that builds their data, and
a Node driver that runs the same scenario code without k6. The spec is the
authority (`docs/specs/spec-redraft-leagues.md` §22.6, v2.16.100); the
decisions are PROGRESS D570 / D571 and D600–D606.

**Never production.** Every entry point refuses the production project by
name. The name is read at run time from this machine (the repo's
`supabase link` file and `.env.local`); the harness never writes it down. A
test target is refused outright when no production name can be read.

## Layout

| Path | What it is |
| --- | --- |
| `load/k6/config.ts` | The one config: profiles `smoke`, `y2026`, `ga` (TD1), the §22.6 thresholds, the target guard (TD2) |
| `load/k6/scenarios/*.ts` | The scenario bodies (one VU = one client), written against `lib/transport.ts` |
| `load/k6/s1…s4-*.k6.ts` | The k6 entries |
| `scripts/load/seed-staging.ts` | The seeder (`--scenario snake \| auction \| leagues`, `--cleanup`, `--census`) |
| `scripts/load/k6.ts` | The wrapper every k6 run goes through |
| `scripts/load/run-node.ts` | The same scenarios on Node (harness checks; not a §22.6 result) |
| `scripts/load/sunday-replay.ts` | Scenario 3's feeder: replays a recording through the production ingest and worker |
| `load/.out/` | Seeder manifests (bot passwords, row ids). Gitignored. |

## Before the first run on the test project (C1)

1. The hosted test project exists (Chris, breakdown §12 C1). Migrations go on
   with `npx supabase db push --db-url <test project>`. Never `supabase link`
   the repo to it.
2. Its `players` table is synced (`sync:players` pointed at it). The seeder
   never writes players.
3. `.env.test-project.local` at the repo root (gitignored; breakdown §12
   C1 (b)) holds the test project's `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`
   (`FS_LOAD_URL` / `FS_LOAD_ANON_KEY` / `FS_LOAD_SERVICE_KEY` also work).
4. k6 v1.x is installed on the machine that runs the load (PROGRESS F702).
5. Scenario 3 needs a recording taken during a real Sunday (PROGRESS F700).

## Running

```bash
# 1 — snake drafts
npx tsx scripts/load/seed-staging.ts --target test --profile y2026 --scenario snake
npx tsx scripts/load/k6.ts s1 --target test --profile y2026

# 2 — auction bid storm
npx tsx scripts/load/seed-staging.ts --target test --profile y2026 --scenario auction
npx tsx scripts/load/k6.ts s2 --target test --profile y2026

# 3 — Sunday replay (feeder + viewers side by side), once per speed, re-seeding between
npx tsx scripts/load/seed-staging.ts --target test --profile y2026 --scenario leagues --recording <rec>
npx tsx scripts/load/sunday-replay.ts --target test --profile y2026 --recording <rec> --speed 1
npx tsx scripts/load/k6.ts s3 --target test --profile y2026 --minutes <replay length>

# 4 — 24 h soak with churn (reuses the leagues seed)
npx tsx scripts/load/k6.ts s4 --target test --profile y2026

# afterwards
npx tsx scripts/load/seed-staging.ts --target test --cleanup
```

`--target local --profile smoke` runs the same commands against the local
stack, to check the harness itself. A local run is not a §22.6 result.
