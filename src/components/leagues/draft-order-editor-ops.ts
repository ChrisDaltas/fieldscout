/**
 * Draft-order editor — pure derivation (M2 task L.B3.4; spec §8.3). Split
 * from the component per the ops precedent (vitest runs .ts, no JSX).
 */

/**
 * The saved order reconciled against the CURRENT non-retired franchises:
 * saved ids that still exist keep their order (deduped), franchises the
 * save doesn't know are appended in list order — so the editor always shows
 * every draftable seat exactly once, and a stale save (a team retired or a
 * league resized since) degrades to a full valid list instead of a
 * permutation `draft_start` would refuse.
 */
export function reconcileDraftOrder(
  saved: readonly string[] | null,
  activeTeamIds: readonly string[],
): string[] {
  const active = new Set(activeTeamIds)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of saved ?? []) {
    if (active.has(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  for (const id of activeTeamIds) {
    if (!seen.has(id)) out.push(id)
  }
  return out
}
