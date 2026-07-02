/**
 * Cred rank tiers from PRD F5. Thresholds are first-pass numbers — they're
 * what the dashboard uses to compute progress to next rank. Tweak as the
 * cred system matures.
 */
export interface CredTier {
  level: number
  name: string
  threshold: number // total cred required to enter this tier
  accent: string // hex color for the tier badge
}

export const CRED_TIERS: CredTier[] = [
  { level: 1, name: 'Freshie', threshold: 0, accent: '#6B6B6B' },
  { level: 2, name: 'Sophomore', threshold: 100, accent: '#7B8FA1' },
  { level: 3, name: 'JV', threshold: 300, accent: '#3B82F6' },
  { level: 4, name: 'Varsity', threshold: 600, accent: '#60A5FA' },
  { level: 5, name: 'Rookie', threshold: 1000, accent: '#86EFAC' },
  { level: 6, name: 'Veteran', threshold: 1750, accent: '#1DB954' },
  { level: 7, name: 'All Pro', threshold: 2750, accent: '#FFD700' },
  { level: 8, name: 'Local Legend', threshold: 4000, accent: '#FFC400' },
  { level: 9, name: 'Hall of Famer', threshold: 6000, accent: '#FB7E15' },
  { level: 10, name: 'GOAT', threshold: 9000, accent: '#1DB954' },
]

export interface CredRankInfo {
  current: CredTier
  next: CredTier | null
  progressPct: number
  toNext: number
}

export function computeCredRank(totalCred: number): CredRankInfo {
  let currentIdx = 0
  for (let i = CRED_TIERS.length - 1; i >= 0; i--) {
    if (totalCred >= CRED_TIERS[i].threshold) {
      currentIdx = i
      break
    }
  }
  const current = CRED_TIERS[currentIdx]
  const next = CRED_TIERS[currentIdx + 1] ?? null

  if (!next) {
    return { current, next: null, progressPct: 100, toNext: 0 }
  }

  const span = next.threshold - current.threshold
  const into = Math.max(0, totalCred - current.threshold)
  const progressPct = Math.min(100, Math.round((into / span) * 100))
  return {
    current,
    next,
    progressPct,
    toNext: Math.max(0, next.threshold - totalCred),
  }
}
