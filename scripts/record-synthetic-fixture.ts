/**
 * record:synthetic-fixture — write the M0 gate's multi-poll determinism
 * fixture (task L.A0.6 item 1; D7) to
 * fixtures/nfl/2026/wk02/synthetic.jsonl.gz.
 *
 * The session itself is pure engine code (src/lib/leagues/gate/
 * m0-fixture-session.ts) — this script is only the fs/gzip shell. Zero
 * network: the recorded provider is the §23.6 synthetic tier on a virtual
 * clock. The gate test re-records the identical session in-process and
 * compares byte-for-byte, so regenerating after a deliberate scenario-library
 * version bump is exactly: npm run record:synthetic-fixture.
 */
import { gzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { serializeFixture } from '../src/lib/leagues/stats/fixtures/fixture-format'
import {
  FIXTURE_SEASON,
  FIXTURE_WEEK,
  recordHappyPathSession,
} from '../src/lib/leagues/gate/m0-fixture-session'
import { fail } from './_sync-cli'

async function main() {
  const recording = await recordHappyPathSession()
  const jsonl = serializeFixture(recording)
  const outPath = resolve(
    process.cwd(),
    `fixtures/nfl/${FIXTURE_SEASON}/wk${String(FIXTURE_WEEK).padStart(2, '0')}/${recording.header.provider}.jsonl.gz`,
  )
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, gzipSync(jsonl))
  console.log(
    `Done [record:synthetic-fixture] ${recording.entries.length} entries → ${outPath}`,
  )
}

main().catch(fail)
