/**
 * Tier-indicator derivation (M1 task L.A1.8; D44, F20).
 *
 * The dot-product engine sees only keys (D44 — no dst_model discriminator
 * exists in engine code). This pure helper one-hots the def_pa_* / def_ya_*
 * tier-indicator keys from the raw column-stored sources at scoring time;
 * the indicators are never persisted (registry storage: 'derived').
 *
 * F20 — COLD BUCKETS ARE DELIVERED-ZERO (PROGRESS ledger, R56/D44/D56(3);
 * discharged here with the required semantics, no ruled alternative):
 * whenever the raw source key (`def_points_allowed` / `def_yards_allowed`)
 * is delivered, the ENTIRE derived family is emitted as explicit 0/1 — the
 * defense delivered a zero for every cold bucket; it is known, not pending.
 * Absent-key = §23.5 pending (E61's honest badge), so emitting only the hot
 * bucket would badge every normal week incomplete (def_pa_46_plus "pending"
 * on a PA=20 week). The pending path stays reachable ONLY when the raw
 * source itself is genuinely unreported: no source key → no family keys.
 *
 * Bucket boundaries are explicit literals here (reviewable, falsifiable),
 * cross-checked mechanically against the STAT_KEYS registry by test — every
 * storage:'derived' def_pa_/def_ya_ registry key must appear in exactly one
 * table row and vice versa (one namespace, L.A1.7/§7.3.3).
 *
 * Families overlap by design (spec v2.8.3 erratum): ESPN's published PA
 * buckets (14–17 / 18–27 / 35–45 / 46+) sit beside the shared D21 family
 * (14–20 / 21–27 / 35+); 0 / 1–6 / 7–13 / 28–34 are genuinely shared. A
 * PA=15 week hots def_pa_14_20 AND def_pa_14_17 — harmless, because a
 * template references only its own platform's buckets (§7.3.3; the v1.1
 * custom-editor double-pay footgun is ledgered as F21, not this task).
 */

export interface TierBucket {
  key: string
  /** Inclusive bounds; -Infinity/Infinity for the open ends. */
  lo: number
  hi: number
}

/** Raw source key for the def_pa_* family (registry storage: 'column'). */
export const DEF_PA_SOURCE_KEY = 'def_points_allowed'
/** Raw source key for the def_ya_* family (registry storage: 'column'). */
export const DEF_YA_SOURCE_KEY = 'def_yards_allowed'

/**
 * Points-allowed indicators: the shared D21 family + ESPN's published
 * buckets (spec v2.8.3; support.espn.com Scoring-Formats 360003914032,
 * retrieved 2026-07-20 in the L.A1.7 session). def_pa_0 is pinned to
 * exactly 0 — a scoreless opponent — per every platform's published table.
 */
export const DEF_PA_BUCKETS: readonly TierBucket[] = [
  // Shared family (D21): 0 / 1–6 / 7–13 / 14–20 / 21–27 / 28–34 / 35+
  { key: 'def_pa_0', lo: 0, hi: 0 },
  { key: 'def_pa_1_6', lo: 1, hi: 6 },
  { key: 'def_pa_7_13', lo: 7, hi: 13 },
  { key: 'def_pa_14_20', lo: 14, hi: 20 },
  { key: 'def_pa_21_27', lo: 21, hi: 27 },
  { key: 'def_pa_28_34', lo: 28, hi: 34 },
  { key: 'def_pa_35_plus', lo: 35, hi: Infinity },
  // ESPN's own buckets where they diverge (v2.8.3 erratum)
  { key: 'def_pa_14_17', lo: 14, hi: 17 },
  { key: 'def_pa_18_27', lo: 18, hi: 27 },
  { key: 'def_pa_35_45', lo: 35, hi: 45 },
  { key: 'def_pa_46_plus', lo: 46, hi: Infinity },
]

/**
 * Yards-allowed indicators (Q3 ruling; ESPN's published buckets, same
 * source). def_ya_0_99 is the "<100" bucket — a (rare but real) negative
 * total-yards game belongs to it, hence the open lower bound.
 */
export const DEF_YA_BUCKETS: readonly TierBucket[] = [
  { key: 'def_ya_0_99', lo: -Infinity, hi: 99 },
  { key: 'def_ya_100_199', lo: 100, hi: 199 },
  { key: 'def_ya_200_299', lo: 200, hi: 299 },
  { key: 'def_ya_300_349', lo: 300, hi: 349 },
  { key: 'def_ya_350_399', lo: 350, hi: 399 },
  { key: 'def_ya_400_449', lo: 400, hi: 449 },
  { key: 'def_ya_450_499', lo: 450, hi: 499 },
  { key: 'def_ya_500_549', lo: 500, hi: 549 },
  { key: 'def_ya_550_plus', lo: 550, hi: Infinity },
]

function emitFamily(
  out: Record<string, number>,
  buckets: readonly TierBucket[],
  value: number,
): void {
  for (const { key, lo, hi } of buckets) {
    out[key] = value >= lo && value <= hi ? 1 : 0
  }
}

/**
 * Pure derivation: returns the input stat line plus, per delivered raw
 * source, its FULL indicator family as 0/1 (F20 delivered-zero semantics).
 * A raw source that is absent — or defensively non-finite — emits none of
 * its family, leaving those rules keys to the calculator's pending path.
 *
 * The derived families are FULLY authoritative: any incoming def_pa_* /
 * def_ya_* key is stripped regardless (indicators are never stored, D44, so
 * an inbound value is by definition bogus) — an indicator can exist in the
 * output only because its raw source was delivered this call.
 */
export function deriveTierIndicators(
  raw: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...raw }
  for (const { key } of DEF_PA_BUCKETS) delete out[key]
  for (const { key } of DEF_YA_BUCKETS) delete out[key]

  const pa = raw[DEF_PA_SOURCE_KEY]
  if (typeof pa === 'number' && Number.isFinite(pa)) {
    emitFamily(out, DEF_PA_BUCKETS, pa)
  }

  const ya = raw[DEF_YA_SOURCE_KEY]
  if (typeof ya === 'number' && Number.isFinite(ya)) {
    emitFamily(out, DEF_YA_BUCKETS, ya)
  }

  return out
}
