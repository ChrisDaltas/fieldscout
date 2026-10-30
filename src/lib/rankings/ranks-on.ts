import { featureFlags } from '@/lib/feature-flags'

/**
 * Are rankings switched on? The one answer Community asks — the phone feed,
 * the desktop feed and community search (plan C3) — so the rankings rework
 * changes it in one place.
 *
 * Today that is the Weekly ranks switch alone: every Community ranking (the
 * season board, the weekly boards, the AI experts' boards) opens in
 * `/app/weekly-ranks`, which that switch gates. Big Board on by itself still
 * shows no rankings in Community (readiness F2) — the rework decides whether
 * its Rest of season ranking joins this answer.
 *
 * Read at call time, not import time, so a switch read through a mocked
 * `featureFlags` follows the mock.
 */
export function ranksOn(): boolean {
  return featureFlags.weeklyRanks
}
