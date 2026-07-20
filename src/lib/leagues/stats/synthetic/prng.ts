/**
 * Seeded deterministic PRNG for the synthetic tier (spec §23.6; M0 task
 * L.A0.3). No Math.random anywhere in league-engine code — the D3 lint guard
 * bans it mechanically, same spirit as the wall-clock ban.
 *
 * Streams are keyed by (seed, playerId) ONLY — never by scenario id — so two
 * scenarios sharing a slate and seed produce identical stat lines. That
 * cross-scenario equality is load-bearing: the provider_outage back-fill
 * assertion compares recovered lines against a same-seed happy_path run.
 */

/** FNV-1a 32-bit string hash — stable, dependency-free. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32 — small, fast, deterministic 32-bit PRNG. Returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The per-player stream every synthetic stat line draws from. */
export function playerRng(seed: number, playerId: string): () => number {
  return mulberry32((seed ^ hashString(playerId)) >>> 0)
}

/** Uniform integer in [lo, hi] (inclusive) from an rng stream. */
export function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1))
}
