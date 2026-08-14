/**
 * Attach-list derivations — pure ops for `attach-list-modal.tsx` (M2 task
 * L.B4.2; spec §7.4, §16.2 attach-list-modal; PROGRESS D122).
 *
 * THE SMART-SUGGESTION HEURISTIC (the §7.4 "format match" one-tap — task
 * latitude, recorded here and in D122): lists carry no free-form format
 * metadata, but they DO carry `scoring_system_id` — the same catalog the
 * league's scoring template lives in — so "a list's scoring/format matches
 * the league" is implemented as an exact `scoring_system_id` match (both
 * sides non-null). When no list matches, the unattached **Big Board** is
 * suggested instead: it is §8.9's always-relevant default reference and
 * §8.4's autopick fallback, so attaching it is never a wrong suggestion.
 * Anything fuzzier (title parsing, position_filter guesses) was rejected as
 * noise dressed up as intelligence.
 */
import type { MyDraftList } from '@/hooks/use-league-lists'

export interface AttachCandidate extends MyDraftList {
  /** Already attached BY THE CALLER to the target league (picker disables). */
  attached: boolean
}

/**
 * League-side picker rows: Big Board first (§8.9's default reference), then
 * most recently updated. Attached rows stay listed — disabled with an
 * "Attached" flag — so the picker never looks like lists went missing.
 */
export function attachCandidates(
  lists: readonly MyDraftList[],
  attachedListIds: ReadonlySet<string>,
): AttachCandidate[] {
  const rows = lists.map((list) => ({ ...list, attached: attachedListIds.has(list.id) }))
  return rows.sort((a, b) => {
    if (Boolean(a.is_big_board) !== Boolean(b.is_big_board)) return a.is_big_board ? -1 : 1
    return (b.updated_at ?? '').localeCompare(a.updated_at ?? '')
  })
}

/**
 * The one-tap suggestion (§7.4): the newest UNATTACHED list whose
 * `scoring_system_id` matches the league's; else the unattached Big Board;
 * else null (no banner — a suggestion with no basis is noise).
 */
export function attachSuggestion(
  lists: readonly MyDraftList[],
  leagueScoringSystemId: string | null,
  attachedListIds: ReadonlySet<string>,
): MyDraftList | null {
  const open = lists.filter((list) => !attachedListIds.has(list.id))
  if (leagueScoringSystemId) {
    const match = open
      .filter((list) => list.scoring_system_id === leagueScoringSystemId)
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0]
    if (match) return match
  }
  return open.find((list) => list.is_big_board === true) ?? null
}

export interface LeagueOption {
  id: string
  name: string
  status: string
  attached: boolean
}

/** Draft-relevance order for the FROM-LIST side's league picker: a live
 *  draft needs its list NOW, then the scheduled one, then setup; post-draft
 *  statuses trail (attaching stays legal — lists are season references,
 *  §7.4 "one tap away … all season"). */
const STATUS_ORDER: Record<string, number> = {
  drafting: 0,
  scheduled: 1,
  setup: 2,
  in_season: 3,
  playoffs: 4,
  complete: 5,
}

export function leagueOptions(
  leagues: ReadonlyArray<{ id: string; name: string; status: string }>,
  attachedLeagueIds: ReadonlySet<string>,
): LeagueOption[] {
  return leagues
    .map((league) => ({
      id: league.id,
      name: league.name,
      status: league.status,
      attached: attachedLeagueIds.has(league.id),
    }))
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        a.name.localeCompare(b.name),
    )
}

/** Post-attach toast copy (one place, both modal directions). */
export function attachedToastLine(
  listTitle: string,
  leagueName: string,
  primary: boolean,
  shared: boolean,
): string {
  const extras = [
    primary ? 'your primary board' : null,
    shared ? 'shared with the league' : null,
  ].filter((part): part is string => part !== null)
  const base = `“${listTitle}” is attached to ${leagueName}`
  return extras.length > 0 ? `${base} — ${extras.join(', ')}.` : `${base}.`
}
