import type { PostgrestErrorLike } from '@/lib/supabase/postgrest-errors'
import { RANKING_MODES, type RankingMode } from '@/types/schemas/lists'

/**
 * A list's Ranked and Tiers switches (Chris, 2026-10-15: "allow tiers
 * without numbers"). They are independent, and `lists.ranking_mode` stores
 * the pair as one of four values:
 *
 *   | ranking_mode    | Ranked (1-2-3 numbers) | Tiers (Tier 1, Tier 2… headings) |
 *   | `unranked`      | off                    | off                              |
 *   | `ranked`        | on                     | off                              |
 *   | `rank_and_tier` | on                     | on                               |
 *   | `tier_only`     | off                    | on   (migration 191)             |
 *
 * Every surface reads the switches through {@link isNumbered} and
 * {@link hasTiers} and writes them through {@link withNumbers} /
 * {@link withTiers}, so no screen compares the column to a single value and
 * misses the fourth. (The desktop's row numbers read
 * {@link showsNumbersOnDesktop} — a Basic list keeps them there, pending a
 * ruling.)
 */

export function isRankingMode(value: unknown): value is RankingMode {
  return typeof value === 'string' && (RANKING_MODES as readonly string[]).includes(value)
}

/**
 * The Ranked switch: does the list show 1-2-3 numbers? A row without a mode
 * (a summary that never selected it) reads as numbered — the column's own
 * default is `ranked`.
 */
export function isNumbered(mode: string | null | undefined): boolean {
  return mode !== 'unranked' && mode !== 'tier_only'
}

/** The Tiers switch: are the players grouped under tier headings? */
export function hasTiers(mode: string | null | undefined): boolean {
  return mode === 'rank_and_tier' || mode === 'tier_only'
}

/** The mode for a pair of switch positions. */
export function rankingModeOf(switches: { numbered: boolean; tiers: boolean }): RankingMode {
  if (switches.tiers) return switches.numbered ? 'rank_and_tier' : 'tier_only'
  return switches.numbered ? 'ranked' : 'unranked'
}

/** Flip the Ranked switch; Tiers stays where it is. */
export function withNumbers(mode: string | null | undefined, numbered: boolean): RankingMode {
  return rankingModeOf({ numbered, tiers: hasTiers(mode) })
}

/** Flip the Tiers switch; Ranked stays where it is. */
export function withTiers(mode: string | null | undefined, tiers: boolean): RankingMode {
  return rankingModeOf({ numbered: isNumbered(mode), tiers })
}

/**
 * Does the DESKTOP list surface draw `#N` (and card ordinals) on this list's
 * rows — the detail panel, the share page, the pop-out window and the
 * side-by-side columns? It also decides whether the flat grouping is named
 * "Ranked" or "Unranked" there (`orgOptionsFor`).
 *
 * Only a tier-only list drops them: that is what was asked (Chris,
 * 2026-10-15, "allow tiers without numbers"). A Basic (`unranked`) list keeps
 * the desktop numbering it has always had — the phone already draws it
 * without numbers — until Chris rules on dropping them on desktop too (open
 * question for him; it was not part of the ask). On his yes this becomes
 * `isNumbered(mode)`, one line, and every desktop surface follows.
 */
export function showsNumbersOnDesktop(mode: string | null | undefined): boolean {
  return mode !== 'tier_only'
}

/**
 * What the desktop grouping control writes when an owner picks a grouping
 * (`list-detail-panel.tsx`, `chooseOrg`). It is the Tiers switch and nothing
 * else: `'tier'` turns tiers on, `'rank'` turns them off, and the list's
 * numbering stays as it is (`withTiers`) — so a ranked list becomes
 * `rank_and_tier` and a Basic one `tier_only`. Any other grouping (round /
 * cost / budget), or a pick that changes nothing, writes nothing.
 *
 * `tierOnlyUnavailable`: this page load already heard the server answer a
 * tier-only save with "coming in the next update" (migration 191 not pushed
 * yet), so the pick stays session-only instead of asking again.
 */
export function groupingWrite(
  current: string | null | undefined,
  next: string,
  opts: { tierOnlyUnavailable?: boolean } = {},
): RankingMode | null {
  const persisted =
    next === 'tier' && !hasTiers(current)
      ? withTiers(current, true)
      : next === 'rank' && hasTiers(current)
        ? withTiers(current, false)
        : null
  if (persisted === 'tier_only' && opts.tierOnlyUnavailable) return null
  return persisted
}

/**
 * One word for what kind of list it is, where a card or chip names it:
 * "Ranking" (numbered, with or without tiers), "Tiers" (tiers, no numbers),
 * or "List" (neither).
 */
export function listKindOf(mode: string | null | undefined): 'Ranking' | 'Tiers' | 'List' {
  if (isNumbered(mode)) return 'Ranking'
  return hasTiers(mode) ? 'Tiers' : 'List'
}

// =============================================================================
// Before migration 191 is pushed
// =============================================================================

/**
 * True when the database refused a write because its `ranking_mode` CHECK
 * predates 191 — i.e. it doesn't know `tier_only` yet. Main deploys before
 * Chris pushes the migration, so for a while a tier-only save reaches a
 * database that answers 23514 naming `lists_ranking_mode_check` (191 keeps
 * that name on purpose).
 *
 * Anchored on the constraint's name: another 23514 on the same write — the
 * suspended private-list cap's trigger raises one too — is never mistaken
 * for this.
 */
export function isTierOnlyUnavailable(error: PostgrestErrorLike | null | undefined): boolean {
  if (!error || error.code !== '23514') return false
  return /\blists_ranking_mode_check\b/.test(error.message ?? '')
}

/**
 * The API's answer to a tier-only save on a database without 191: a clear
 * 409, never a 500. Nothing is saved — the write is one statement.
 */
export const TIER_ONLY_UNAVAILABLE_STATUS = 409
export const TIER_ONLY_UNAVAILABLE_BODY = {
  error: 'Tiers without numbers is coming in the next update.',
  code: 'TIER_ONLY_UNAVAILABLE',
} as const

/**
 * The client side of that answer: true when a failed list write is the
 * "coming in the next update" 409 (the hooks' `jsonOrThrow` copies the
 * body's `code` onto the thrown error), so a screen can say so plainly
 * instead of showing a red "could not save".
 */
export function isTierOnlyUnavailableResponse(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === TIER_ONLY_UNAVAILABLE_BODY.code
  )
}
