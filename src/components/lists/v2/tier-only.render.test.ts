/**
 * Desktop — tiers without numbers (Chris, 2026-10-15; migration 191,
 * `ranking_mode = 'tier_only'`), and one numbering rule for phone and desktop
 * (Chris, 2026-10-16: "just make sure they work consistently").
 *
 * The shared list body (the app's detail panel and the public share page
 * `/u/[username]/lists/[slug]` both mount it) draws a tier-only list with
 * its tier sections and NO `#N` — in all three view styles — and a plain
 * (`unranked`) list with neither numbers nor tiers, exactly as the phone
 * does (`isNumbered`). Both keep the players in their saved order, and the
 * grouping control names the flat mode "Unranked" on either. Every "no
 * number" case is paired with the same render numbered, so a pass can't come
 * from rows that never rendered.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import { isNumbered } from '@/lib/lists/ranking-mode'
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
      numbered: isNumbered(mode),
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
})

describe('ListBody: a plain (unranked) list has no numbers on desktop either', () => {
  it.each(VIEWS)('%s view — positive control: a ranked list is numbered #1–#3', (view) => {
    const out = body('ranked', view)
    for (const n of [1, 2, 3]) expect(out).toContain(`#${n}<`)
  })

  it.each(VIEWS)('%s view — unranked: every player, in the saved order, no #N and no tiers', (view) => {
    const out = body('unranked', view)
    const at = [1, 2, 3].map((n) => out.indexOf(`Player ${n}`))
    for (const i of at) expect(i).toBeGreaterThan(-1)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(out).not.toMatch(/#\d+</)
    // One flat section: the stored S / A keys draw no tier headings.
    expect(out).not.toMatch(/>S</)
    expect(out).not.toMatch(/>A</)
  })

  it('table view drops the # column header on a plain list', () => {
    expect(body('ranked', 'table')).toContain('>#</span>')
    expect(body('unranked', 'table')).not.toContain('>#</span>')
  })

  it('cards drop the ordinal (1st, 2nd…) on a plain list', () => {
    expect(body('ranked', 'card')).toContain('1st')
    expect(body('unranked', 'card')).not.toContain('1st')
  })
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

  it('the flat mode reads "Unranked" on a plain or tier-only list, "Ranked" on a numbered one', () => {
    for (const mode of ['unranked', 'tier_only']) {
      expect(orgOptionsFor(isNumbered(mode))[0].label, mode).toBe('Unranked')
    }
    for (const mode of ['ranked', 'rank_and_tier']) {
      expect(orgOptionsFor(isNumbered(mode))[0].label, mode).toBe('Ranked')
    }
    expect(resolveOrg(null, 'unranked')).toBe('rank')
    expect(toolbar(false, 'rank')).toContain('Unranked')
    expect(toolbar(true, 'rank')).toContain('Ranked')
    expect(toolbar(true, 'rank')).not.toContain('Unranked')
    expect(orgOptionsFor(false).map((o) => o.label)).toEqual(['Unranked', 'Tiers', 'Rounds', 'Avg cost', 'Budget %'])
    expect(orgOptionsFor(true).map((o) => o.label)).toEqual(['Ranked', 'Tiers', 'Rounds', 'Avg cost', 'Budget %'])
  })
})
