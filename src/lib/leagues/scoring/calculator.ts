/**
 * §7.3.3 generic dot-product calculator (M1 task L.A1.8; D33).
 *
 * score = Σ rules[key] × stat(key) over whatever keys the league's snapshot
 * contains — ONE shared key namespace (rules keys ≡ stat keys, §7.3.3), no
 * translation anywhere. This module is deliberately key-agnostic: it imports
 * nothing from the STAT_KEYS registry and never mentions a concrete stat key.
 * Tier-indicator derivation (the def_pa / def_ya one-hot families) lives in
 * ./derive-stats (D44).
 *
 * Pending semantics (§23.5, E61): a rules key with no delivered stat is
 * *pending, never zero* — it appears in `pending`, contributes nothing to
 * `total`, and gets no `perKey` entry (a 0 there would be the silent-wrong
 * -total E61 exists to prevent). A delivered stat of 0 is the opposite case:
 * a real `perKey: 0` entry and absent from `pending` (see derive-stats for
 * why cold tier buckets are delivered-zero, F20).
 *
 * NOT the legacy calculator: src/lib/scoring/default.ts serves research
 * surfaces in its own column-name namespace and is untouched by M1 (D33).
 */

export interface ScoreBreakdown {
  /** Half-up, 2 decimals (§7.3.3 precision rule) — see roundHalfUp. */
  total: number
  /**
   * Per-rules-key contribution (coefficient × stat) at FULL precision —
   * `total` is the rounding of the full-precision sum, not Σ of rounded
   * entries. Delivered keys only; pending keys never appear here.
   */
  perKey: Record<string, number>
  /** Rules keys with no delivered stat — pending, NEVER zero (§23.5/E61). */
  pending: string[]
}

/**
 * §7.3.3 rounding: computed at full precision, stored half-up to 2 decimals
 * (NUMERIC(8,2)). Implemented as round-half-AWAY-FROM-ZERO to match what
 * Postgres NUMERIC(8,2) assignment does — identical to "half up" on the
 * positive domain the spec discusses; negative totals (all-miss K weeks)
 * round like the DB column they land in. The toPrecision(13) snap collapses
 * binary-float accumulation noise (~1e-16 relative) so a true decimal .005
 * boundary rounds up instead of sitting at .00499…; 13 significant digits is
 * far above any real scoring precision and far below float noise.
 */
export function roundHalfUp(value: number): number {
  const sign = value < 0 ? -1 : 1
  const scaled = Number((Math.abs(value) * 100).toPrecision(13))
  return (sign * Math.round(scaled)) / 100
}

/**
 * The generic dot-product. `stats` values count as delivered only when they
 * are finite numbers — absent keys, and defensively NaN/±Infinity, resolve
 * as pending rather than poisoning the total.
 */
export function scorePlayerWeek(
  rules: Record<string, number>,
  stats: Record<string, number>,
): ScoreBreakdown {
  const perKey: Record<string, number> = {}
  const pending: string[] = []
  let sum = 0

  for (const [key, coefficient] of Object.entries(rules)) {
    const stat = stats[key]
    if (typeof stat === 'number' && Number.isFinite(stat)) {
      const contribution = coefficient * stat
      perKey[key] = contribution
      sum += contribution
    } else {
      pending.push(key)
    }
  }

  return { total: roundHalfUp(sum), perKey, pending }
}
