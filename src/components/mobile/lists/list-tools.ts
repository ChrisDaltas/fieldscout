import { bucketHeading, buildBuckets, orgOptionsFor } from '@/components/lists/v2/list-buckets'
import { playerCost } from '@/components/lists/v2/list-stats'
import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import { hasTiers, isNumbered } from '@/lib/lists/ranking-mode'
import { resolveOrg, type ListOrg } from '@/stores/list-display-store'
import { roundNumberOf, type RankingMode } from '@/types/schemas/lists'

import { byPosition, viewSections } from './lists-model'

/**
 * FieldScout Mobile — the desktop list tools a list's "⋯" sheet carries on a
 * phone (gap list §3 #3): group by (Ranked / Tiers / Rounds / Avg cost /
 * Budget %), drafted check-off, notes, and side by side. Pure: no React, no
 * fetches. The buckets themselves are desktop's (`list-buckets.ts`), so a
 * player lands in the same section on both layouts.
 */

// =============================================================================
// Group by
// =============================================================================

export interface GroupOption {
  id: ListOrg
  label: string
  sub: string
}

interface GroupedList {
  ranking_mode: RankingMode | string | null | undefined
  players: readonly ListPlayerWithPlayer[]
}

/** Whether any player sits in a draft round (`r1`…`r30`, set on desktop). */
export function hasRounds(players: readonly ListPlayerWithPlayer[]): boolean {
  return players.some((entry) => roundNumberOf(entry.tier) !== null)
}

/** Whether any player has an average auction price to group by. */
export function hasPrices(players: readonly ListPlayerWithPlayer[]): boolean {
  return players.some((entry) => playerCost(entry) !== null)
}

/**
 * The groupings a phone offers for one list — desktop's five
 * (`orgOptionsFor`), minus any that would change nothing ("prevent, don't
 * refuse"): Tiers only while the list's Tiers switch is on, Rounds only once
 * a player has a round, Avg cost and Budget % only once a player has an
 * auction price. The flat one is "Ranked" on a numbered list and "Unranked"
 * otherwise (the one numbering rule, 2026-10-16).
 */
export function groupOptions(list: GroupedList): GroupOption[] {
  const names = new Map(orgOptionsFor(isNumbered(list.ranking_mode)).map((option) => [option.id, option.label]))
  const options: GroupOption[] = [
    { id: 'rank', label: names.get('rank') ?? 'Ranked', sub: 'One list, in your order' },
  ]
  if (hasTiers(list.ranking_mode)) options.push({ id: 'tier', label: names.get('tier') ?? 'Tiers', sub: 'Your tier lines' })
  if (hasRounds(list.players)) options.push({ id: 'round', label: names.get('round') ?? 'Rounds', sub: 'By draft round' })
  if (hasPrices(list.players)) {
    options.push({ id: 'cost', label: names.get('cost') ?? 'Avg cost', sub: 'By average auction price' })
    options.push({ id: 'budget', label: names.get('budget') ?? 'Budget %', sub: 'By share of your auction budget' })
  }
  return options
}

/**
 * The grouping a phone draws: the session's pick (the shared display store,
 * as desktop and the side-by-side columns read it), else the list's own —
 * and the list's own whenever the pick isn't one this list offers (a Tiers
 * pick on a list whose tiers were since switched off).
 */
export function resolveGroup(override: ListOrg | null | undefined, list: GroupedList): ListOrg {
  const chosen = resolveOrg(override, list.ranking_mode)
  if (groupOptions(list).some((option) => option.id === chosen)) return chosen
  return resolveOrg(null, list.ranking_mode)
}

export interface GroupSection {
  key: string
  /** `null` = no header (one flat list). */
  label: string | null
  /** 0-based step on the tier ramp, or -1 for a neutral header (Ungrouped,
   *  No auction value). */
  colorIndex: number
  /** A cost or budget band's running spend ("$64"). */
  meta: string | null
  entries: ListPlayerWithPlayer[]
}

const NEUTRAL_KEYS = new Set(['ungrouped', 'unpriced'])

/**
 * The List view's sections for a grouping. Tiers are the phone's own
 * ("Tier 1", "Tier 2"… in order, `viewSections`); rounds, cost and budget are
 * desktop's buckets with desktop's headings ("Round 3", "$40 and up", "Over
 * 20% of budget"). A band nobody is in is left out — on a phone a heading
 * with nothing under it reads as a loading gap. Every player stays on the
 * list: by Budget %, players with no price sit under "No auction value" as
 * they do by Avg cost (desktop's budget bands drop them).
 */
export function groupSections(players: readonly ListPlayerWithPlayer[], org: ListOrg, budget: number): GroupSection[] {
  if (org === 'rank' || org === 'tier') {
    return viewSections(players, org === 'tier').map((section, index) => ({
      key: section.label ?? `all-${index}`,
      label: section.label,
      colorIndex: section.tierIndex,
      meta: null,
      entries: section.entries,
    }))
  }
  const ordered = byPosition(players)
  const buckets = buildBuckets({ org, entries: ordered, bandLabels: {}, budget })
  if (org === 'budget') {
    const unpriced = ordered.filter((entry) => playerCost(entry) === null)
    if (unpriced.length > 0) {
      buckets.push({ key: 'unpriced', label: 'No auction value', meta: null, className: '', editableKey: null, entries: unpriced })
    }
  }
  let step = 0
  return buckets
    .filter((bucket) => bucket.entries.length > 0)
    .map((bucket) => {
      const neutral = NEUTRAL_KEYS.has(bucket.key)
      const colorIndex = neutral ? -1 : step
      if (!neutral) step += 1
      return {
        key: bucket.key,
        label: bucketHeading(org, bucket),
        colorIndex,
        meta: bucket.meta,
        entries: bucket.entries,
      }
    })
}

// =============================================================================
// Drafted and notes
// =============================================================================

/** How many of this list's players carry a drafted mark. */
export function draftedCount(players: readonly ListPlayerWithPlayer[], drafted: ReadonlySet<string>): number {
  return players.reduce((n, entry) => n + (drafted.has(entry.player_id) ? 1 : 0), 0)
}

/** A player's note, trimmed, or null when there's nothing to show. */
export function noteOf(entry: Pick<ListPlayerWithPlayer, 'notes'>): string | null {
  const note = entry.notes?.trim()
  return note ? note : null
}

export function notesCount(players: readonly ListPlayerWithPlayer[]): number {
  return players.reduce((n, entry) => n + (noteOf(entry) ? 1 : 0), 0)
}

/** "1 note" / "3 notes". */
export function notesLabel(n: number): string {
  return `${n} ${n === 1 ? 'note' : 'notes'}`
}

// =============================================================================
// Side by side
// =============================================================================

/** Most columns one comparison holds. */
export const MAX_COMPARE = 6

/** `?compare=` → the list ids, in order, deduped and capped. */
export function compareIdsOf(param: string | null | undefined): string[] {
  if (!param) return []
  const ids: string[] = []
  for (const raw of param.split(',')) {
    const id = raw.trim()
    if (id && !ids.includes(id)) ids.push(id)
    if (ids.length === MAX_COMPARE) break
  }
  return ids
}

export function compareHref(ids: readonly string[]): string {
  return `/app/lists?compare=${ids.map((id) => encodeURIComponent(id)).join(',')}`
}

/** "Show 3 lists side by side", or what's still missing. */
export function compareButtonLabel(count: number, anchored: boolean): string {
  if (count < 2) return anchored ? 'Pick a list to compare' : 'Pick at least 2 lists'
  return `Show ${count} lists side by side`
}

/** A column's sub-line: "18 of 24 left". */
export function leftLabel(players: readonly ListPlayerWithPlayer[], drafted: ReadonlySet<string>): string {
  return `${players.length - draftedCount(players, drafted)} of ${players.length} left`
}
