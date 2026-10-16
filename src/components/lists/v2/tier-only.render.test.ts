/**
 * Desktop — tiers without numbers (Chris, 2026-10-15; migration 191,
 * `ranking_mode = 'tier_only'`).
 *
 * The shared list body (the app's detail panel and the public share page
 * `/u/[username]/lists/[slug]` both mount it) draws a tier-only list with
 * its tier sections and NO `#N` — in all three view styles — and the grouping
 * control names the flat mode "Unranked" there. A Basic (`unranked`) list
 * keeps the desktop numbers it always had (`showsNumbersOnDesktop`) until
 * Chris rules on dropping them — that was not part of the ask. Every "no
 * number" case is paired with the same render numbered, so a pass can't come
 * from rows that never rendered.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import { showsNumbersOnDesktop } from '@/lib/lists/ranking-mode'
import { DEFAULT_BUDGET, resolveOrg, type ListView } from '@/stores/list-display-store'

import { ListBody, type RowHandlers } from './list-body'
import { buildBuckets, orgOptionsFor } from './list-buckets'
import { ListToolbar } from './list-toolbar'

function entry(n: number, tier: string): ListPlayerWithPlayer {
  return {
    id: `e${n}`,
    list_id: 'l1',
    player_id: `p${n}`,
    position: n,
    tier,
    added_at: null,
    notes: null,
    overall_rank: n,
    rank_in_tier: null,
    slot: null,
    updated_at: null,
    player: { id: `p${n}`, full_name: `Player ${n}`, position: 'WR', team: 'NYG', headshot_url: null, status: null },
    stats: null,
  } as unknown as ListPlayerWithPlayer
}

const ENTRIES = [entry(1, 'S'), entry(2, 'S'), entry(3, 'A')]
const READ_ONLY: RowHandlers = { canEdit: false, canMark: false, isDrafted: () => false }

const html = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&amp;/g, '&')

/** The body as the share page mounts it, for a list stored in `mode`. */
function body(mode: string, view: ListView): string {
  const org = resolveOrg(null, mode)
  return html(
    createElement(ListBody, {
      buckets: buildBuckets({ org, entries: ENTRIES, bandLabels: {}, budget: DEFAULT_BUDGET }),
      stats: [],
      view,
      org,
      numbered: showsNumbersOnDesktop(mode),
      showBudgetShare: false,
      budget: DEFAULT_BUDGET,
      handlers: READ_ONLY,
    }),
  )
}

const VIEWS: ListView[] = ['list', 'table', 'card']

describe('ListBody: a tier-only list has tiers and no numbers', () => {
  it.each(VIEWS)('%s view — positive control: a ranked tier list is numbered #1–#3', (view) => {
    const out = body('rank_and_tier', view)
    for (const n of [1, 2, 3]) expect(out).toContain(`#${n}<`)
    expect(out).toContain('Player 3')
  })

  it.each(VIEWS)('%s view — tier_only: the tier sections and players, no #N', (view) => {
    const out = body('tier_only', view)
    // Grouped by tier (it opens tiered, like rank_and_tier): S and A sections.
    expect(out).toMatch(/>S</)
    expect(out).toMatch(/>A</)
    for (const n of [1, 2, 3]) expect(out).toContain(`Player ${n}`)
    expect(out).not.toMatch(/#\d+</)
  })

  it('table view drops the # column header with the numbers', () => {
    expect(body('ranked', 'table')).toContain('>#</span>')
    expect(body('tier_only', 'table')).not.toContain('>#</span>')
  })

  it('cards drop the list-order ordinal too (1st, 2nd…) — it is a list number', () => {
    expect(body('rank_and_tier', 'card')).toContain('1st')
    expect(body('tier_only', 'card')).not.toContain('1st')
  })

  it.each(VIEWS)(
    '%s view — a Basic (unranked) list keeps its desktop numbers, as before 191 (pending Chris)',
    (view) => {
      const out = body('unranked', view)
      for (const n of [1, 2, 3]) expect(out).toContain(`#${n}<`)
      expect(body('tier_only', view)).not.toMatch(/#\d+</)
    },
  )
})

describe('the grouping control', () => {
  const toolbar = (numbered: boolean, org: 'rank' | 'tier') =>
    html(
      createElement(ListToolbar, {
        org,
        onOrgChange: () => {},
        numbered,
        view: 'list',
        onViewChange: () => {},
        cols: [],
        onToggleCol: () => {},
        budget: DEFAULT_BUDGET,
        onBudgetChange: () => {},
        showBudget: false,
        canEdit: false,
      }),
    )

  it('a tier-only list opens on Tiers', () => {
    expect(resolveOrg(null, 'tier_only')).toBe('tier')
    expect(toolbar(false, 'tier')).toContain('Tiers')
  })

  it('the flat mode reads "Unranked" on a tier-only list, "Ranked" on a numbered or Basic one', () => {
    expect(orgOptionsFor(showsNumbersOnDesktop('tier_only'))[0].label).toBe('Unranked')
    for (const mode of ['unranked', 'ranked', 'rank_and_tier']) {
      expect(orgOptionsFor(showsNumbersOnDesktop(mode))[0].label, mode).toBe('Ranked')
    }
    expect(toolbar(false, 'rank')).toContain('Unranked')
    expect(toolbar(true, 'rank')).toContain('Ranked')
    expect(toolbar(true, 'rank')).not.toContain('Unranked')
    expect(orgOptionsFor(false).map((o) => o.label)).toEqual(['Unranked', 'Tiers', 'Rounds', 'Avg cost', 'Budget %'])
    expect(orgOptionsFor(true).map((o) => o.label)).toEqual(['Ranked', 'Tiers', 'Rounds', 'Avg cost', 'Budget %'])
  })
})
