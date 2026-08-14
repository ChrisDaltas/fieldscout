/**
 * Seeded stream helpers for the simulator — M2 task L.B6.1.
 *
 * Reuses the ONE league-engine PRNG (stats/synthetic/prng.ts — mulberry32;
 * the determinism guard bans every ambient random source). Two additions:
 *
 *   - `deriveStream(seed, label)` — a child stream keyed by (seed, label).
 *     Concurrency-critical: 25 league loops run interleaved, so a SINGLE
 *     shared stream would be consumed in scheduler order and no two runs
 *     would replay alike. Per-league child streams make every league's
 *     decision sequence a pure function of (seed, league index) regardless
 *     of interleaving — the `--seed` replay contract (plan principle 4).
 *
 *   - `uuidFromRng(rng)` — v4-SHAPED uuids from a stream (action_ids, the
 *     D68(1) per-submit stamping pattern with the entropy injected). The
 *     runner salts its action-id streams with the CLI-supplied run tag so a
 *     same-seed re-run can never replay into a previous run's E2 dedupe
 *     rows (recorded latitude — DECISIONS replay from the seed; action_ids
 *     are per-run nonces by design, exactly like the routes' per-submit
 *     minting).
 */
import { hashString, mulberry32 } from '../stats/synthetic/prng'

export function deriveStream(seed: number, label: string): () => number {
  return mulberry32(((seed >>> 0) ^ hashString(label)) >>> 0)
}

/** RFC-4122 v4-shaped uuid drawn from a seeded stream. */
export function uuidFromRng(rng: () => number): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(rng() * 256))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // RFC variant
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
