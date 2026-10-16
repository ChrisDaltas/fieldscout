/**
 * FieldScout Mobile — Rankings render pins for Chris's 2026-10-15 rulings:
 *   - Publish: one commit button ("Publish" / "Publish updates"), no
 *     "save without publishing", and the published wording where mobile
 *     Rankings used to say "Saved".
 *   - Weeks: this week + the next three + Rest of season; later weeks are
 *     locked ("Opens in Week N"), and opening an upcoming week with no board
 *     never touches the board-creating weekly route.
 * `renderToStaticMarkup` over the real components, the React Query cache
 * pre-seeded (fetches are effects, so the cache IS the data).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/weekly-ranks',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ profile: { username: 'dalton', avatar_url: null }, user: { id: 'u1' } }),
}))

import { bigBoardKeys } from '@/hooks/use-big-board'
import { mobileRankingBoardsKey, type BoardPlayerLite, type MyRankingBoards } from '@/hooks/use-mobile-rankings-boards'

import type { BoardSourcePlayer } from '@/hooks/use-board-sources'
import type { ExpertBoard, ExpertsSource, HubRow } from '@/hooks/use-mobile-rankings-sources'

import { MyRankingsBody } from './my-rankings'
import { NewRanking } from './new-ranking'
import { RankingEditor } from './ranking-editor'
import { RankingsHub, type RankingsNav } from './rankings-hub'
import type { Movement, RankFrom, RankPos, RankType, RankingsUrlState } from './rankings-ops'

const CURRENT_WEEK = 6
const STAMP = '2026-10-13T12:00:00Z'

function row(listId: string, n: number, name: string, pos: string): BoardPlayerLite {
  return {
    list_id: listId,
    player_id: `${pos}-${n}`,
    position: n,
    updated_at: STAMP,
    added_at: STAMP,
    player: { id: `${pos}-${n}`, full_name: name, position: pos, team: 'KC', headshot_url: null },
  }
}

/** Season board (RB), a played Week 5 (QB) and this week's board (WR).
 *  Weeks 7–9 have no board yet. */
const BOARDS: MyRankingBoards = {
  season: { listId: 'season', week: 0, players: [row('season', 1, 'Bijan Robinson', 'RB')] },
  weeks: [
    { listId: 'w5', week: 5, players: [row('w5', 1, 'Josh Allen', 'QB')] },
    { listId: 'w6', week: 6, players: [row('w6', 1, "Ja'Marr Chase", 'WR')] },
  ],
}

function client(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(mobileRankingBoardsKey('u1'), BOARDS)
  return qc
}

function render(el: ReactElement, qc = client()): string {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, el))
}

/** Visible text, tags stripped (React splits adjacent text with comments). */
function text(html: string): string {
  return html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
}

const nav: RankingsNav = {
  state: { view: 'mine', src: 'mine', scoring: 'ppr', pos: 'RB', overlay: null },
  currentWeek: CURRENT_WEEK,
  setHub: () => {},
  open: () => {},
}

describe('one Rankings screen (Chris, 2026-10-15: #27, #28, #30, #31, #34)', () => {
  const hub = (state: Partial<RankingsUrlState>, qc = client()) =>
    render(createElement(RankingsHub, { nav: { ...nav, state: { ...nav.state, ...state } } }), qc)

  it('?view=mine opens Rankings on the Mine tab — My rankings’ filters and cards, the other tabs one tap away', () => {
    const html = hub({ view: 'mine', src: 'mine' })
    const t = text(html)
    expect(html).toMatch(/role="heading"[^>]*>Rankings</)
    expect(t).not.toContain('My rankings')
    for (const tab of ['Experts', 'Scout AI', 'Users', 'Mine']) expect(html).toMatch(new RegExp(`role="tab"[^>]*>${tab}`))
    expect(html).toMatch(/aria-selected="true"[^>]*>Mine/)
    expect(t).toMatch(/All\s*3/)
    expect(t).toContain('Week 6 · WR')
  })

  it('the selected tab’s underline is t1 — ink in light mode, white in dark', () => {
    const html = hub({ view: 'mine', src: 'mine' })
    expect(html).toContain('h-[2px] bg-m-t1')
    expect(html).not.toContain('h-[2px] bg-m-ink')
  })

  it('Back is a button (back to where you came from), not a fixed link to Profile', () => {
    const html = hub({ view: 'mine', src: 'mine' })
    expect(html).toMatch(/<button[^>]*aria-label="Back"/)
    expect(html).not.toContain('href="/app/profile"')
  })

  it('the scoring pill names the 0.25 PPR choice', () => {
    expect(text(hub({ view: 'hub', src: 'experts', scoring: 'quarter' }))).toContain('0.25 PPR')
    expect(text(hub({ view: 'hub', src: 'experts', scoring: 'half' }))).toContain('Half PPR')
  })

  it('a source shows its top 36 at the position', () => {
    const qc = client()
    const rows: HubRow[] = Array.from({ length: 40 }, (_, i) => ({
      player: { id: `rb-${i}`, full_name: `Back ${i}`, position: 'RB', team: 'KC', headshot_url: null, bye_week: 10 },
      score: -i,
    }))
    qc.setQueryData(['mobile-rankings', 'source', 'users', 'RB'], rows)
    const html = hub({ view: 'hub', src: 'users', pos: 'RB' }, qc)
    expect(html.match(/, compare sources"/g)?.length).toBe(36)
  })
})

describe('My rankings — periods and the published wording', () => {
  const html = render(createElement(MyRankingsBody, { nav, filter: 'all', setFilter: () => {} }))
  const t = text(html)

  it('filters on Published / Finalized — nothing reads Saved or Draft', () => {
    expect(t).toMatch(/All\s*3/)
    expect(t).toMatch(/Published\s*2/)
    expect(t).toMatch(/Finalized\s*1/)
    expect(t).not.toMatch(/\bSaved\b/)
    expect(t).not.toMatch(/\bDraft\b/)
  })

  it('marks this week’s rankings', () => {
    expect(t).toContain('Week 6 · WR')
    expect(t).toContain('This week · 1 player · Oct 13')
    // A played week and the season board aren't "this week".
    expect(t).toContain('Week 5 · QB')
    expect(t).not.toContain('This week · 1 player · Oct 13 Week 5')
  })

  it('the next three weeks are open to start; later weeks open three weeks before', () => {
    for (const w of [7, 8, 9]) expect(t).toContain(`Week ${w} Not started Start`)
    expect(t).toContain('Week 10 Opens in Week 7')
    expect(t).toContain('Week 18 Opens in Week 15')
    expect(t).not.toContain('Week 10 Not started')
  })
})

describe('New ranking — this week, the next three, and Rest of season', () => {
  const step1 = (type: RankType) =>
    text(
      render(
        createElement(NewRanking, {
          step: 1,
          type,
          pos: 'RB',
          currentWeek: CURRENT_WEEK,
          onClose: () => {},
          onChange: () => {},
          onOpenEditor: () => {},
        }),
      ),
    )

  it('offers Weeks 6–9 with this week marked, and Rest of season', () => {
    const t = step1('w8')
    expect(t).toContain('Week 6 · This week')
    for (const w of [7, 8, 9]) expect(t).toContain(`Week ${w}`)
    expect(t).not.toContain('Week 10')
    expect(t).toContain('Rest of season')
  })

  it('a week that can’t be ranked falls back to this week', () => {
    const html = render(
      createElement(NewRanking, {
        step: 1,
        type: 'w12',
        pos: 'RB',
        currentWeek: CURRENT_WEEK,
        onClose: () => {},
        onChange: () => {},
        onOpenEditor: () => {},
      }),
    )
    expect(html).toMatch(/aria-pressed="true"[^>]*>Week 6/)
    expect(text(html)).not.toContain('Week 12')
  })
})

describe('Ranking editor — Publish and the week rules', () => {
  const editor = (type: RankType, qc = client(), pos: RankPos = 'RB', from: RankFrom | null = null) =>
    render(
      createElement(RankingEditor, {
        type,
        pos,
        from,
        currentWeek: CURRENT_WEEK,
        promptSeq: 0,
        onDirtyChange: () => {},
        onBack: () => {},
        onPublished: () => {},
      }),
      qc,
    )

  it('an upcoming week with no board is a new ranking ("Publish") and never reads the creating route', () => {
    const qc = client()
    const html = editor('w8', qc)
    expect(text(html)).toContain('Week 8 · RB')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Publish<\/button>/)
    expect(text(html)).not.toMatch(/\bSave\b/)
    // The weekly GET creates a board on first read — opening must not.
    expect(qc.getQueryCache().find({ queryKey: bigBoardKeys.week(8), exact: true })).toBeUndefined()
  })

  it('starting from a source over a ranking you have is an update, not a new ranking', () => {
    // The season board and this week's board already hold these positions,
    // so neither reads "Publish" — the draft's edits will publish updates.
    for (const html of [editor('season', client(), 'RB', 'experts'), editor('w6', client(), 'WR', 'p:persona-1')]) {
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Published<\/button>/)
      expect(html).not.toMatch(/>Publish<\/button>/)
    }
    // This week's board holds no RB: that position is still a new ranking.
    expect(editor('w6', client(), 'RB', 'experts')).toMatch(/<button[^>]*disabled=""[^>]*>Publish<\/button>/)
  })

  it('a week past the open range is locked and says when it opens', () => {
    const t = text(editor('w10'))
    expect(t).toContain("Week 10 isn't open yet")
    expect(t).toContain('You can rank this week and the next three. This one opens in Week 7.')
    expect(t).not.toContain('Publish')
  })
})

describe('ADP, Auction and FLEX on the phone (Chris, 2026-10-15, #29)', () => {
  const hub = (state: Partial<RankingsUrlState>, qc = client()) =>
    render(createElement(RankingsHub, { nav: { ...nav, state: { ...nav.state, ...state } } }), qc)
  const market = (id: string, name: string, position: string, adp: number, auction: number): BoardSourcePlayer => ({
    id,
    full_name: name,
    position,
    team: 'KC',
    headshot_url: null,
    bye_week: 10,
    adp,
    projected_pts_standard: null,
    projected_pts_half_ppr: null,
    projected_pts_ppr: null,
    sos: null,
    auction_value: auction,
  })
  // Desktop Big Board's market boards — the same query keys, so one cache.
  const withMarkets = () => {
    const qc = client()
    const players = [
      market('qb1', 'Josh Allen', 'QB', 1.4, 40),
      market('rb1', 'Bijan Robinson', 'RB', 2.6, 61),
      market('wr1', "Ja'Marr Chase", 'WR', 3.2, 58),
      market('te1', 'Brock Bowers', 'TE', 9.8, 30),
    ]
    qc.setQueryData(['board-source', 'adp'], players)
    qc.setQueryData(['board-source', 'auction'], [...players].sort((a, b) => b.auction_value! - a.auction_value!))
    return qc
  }

  it('the tabs run Experts · Scout AI · Users · ADP · Auction · Mine', () => {
    const html = hub({ view: 'hub', src: 'experts' })
    const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1])
    expect(tabs).toEqual(['Experts', 'Scout AI', 'Users', 'ADP', 'Auction', 'Mine'])
  })

  it('the position chips add FLEX after TE', () => {
    const chips = [...hub({ view: 'hub', src: 'users' }).matchAll(/aria-pressed="(?:true|false)"[^>]*>([^<]+)</g)].map((m) => m[1])
    expect(chips).toEqual(['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'D/ST'])
  })

  it('ADP lists the position by draft position and shows each player’s ADP', () => {
    const html = hub({ view: 'hub', src: 'adp', pos: 'RB' }, withMarkets())
    const t = text(html)
    expect(t).toContain('Average draft position')
    expect(t).toContain('B. Robinson')
    expect(t).toMatch(/2\.6\s*ADP/)
    expect(t).not.toContain('J. Allen')
  })

  it('Auction at FLEX is RB / WR / TE by price, with the price', () => {
    const html = hub({ view: 'hub', src: 'auction', pos: 'FLEX' }, withMarkets())
    const t = text(html)
    expect(t).toContain('Average auction price')
    const names = [...html.matchAll(/aria-label="([^"]+), compare sources"/g)].map((m) => m[1])
    expect(names).toEqual(['B. Robinson', "J. Chase", 'B. Bowers'])
    expect(t).toMatch(/\$61\s*Auction/)
  })

  it('Users at FLEX reads the overall users ranking', () => {
    const qc = client()
    const rows: HubRow[] = [
      { player: { id: 'wr', full_name: 'Puka Nacua', position: 'WR', team: 'LAR', headshot_url: null, bye_week: 8 }, score: -1 },
      { player: { id: 'rb', full_name: 'Bijan Robinson', position: 'RB', team: 'ATL', headshot_url: null, bye_week: 5 }, score: -2 },
    ]
    qc.setQueryData(['mobile-rankings', 'source', 'users', 'FLEX'], rows)
    const names = [...hub({ view: 'hub', src: 'users', pos: 'FLEX' }, qc).matchAll(/aria-label="([^"]+), compare sources"/g)].map(
      (m) => m[1],
    )
    expect(names).toEqual(['P. Nacua', 'B. Robinson'])
  })
})

describe('movement arrows (Chris, 2026-10-15, #33)', () => {
  const hub = (state: Partial<RankingsUrlState>, qc: QueryClient) =>
    render(createElement(RankingsHub, { nav: { ...nav, state: { ...nav.state, ...state } } }), qc)
  const expertBoard: ExpertBoard = {
    id: 'e1-rb',
    title: 'Top RB',
    description: null,
    position_filter: 'RB',
    player_count: 3,
    updated_at: STAMP,
    persona: { username: 'e1', display_name: 'Expert One', avatar_url: null, scoring: 'PPR' },
  }
  const p = (id: string, full_name: string) => ({ id, full_name, position: 'RB', team: 'KC', headshot_url: null, bye_week: 10 })
  const withExperts = (movement: ExpertsSource['movement']) => {
    const qc = client()
    qc.setQueryData(['mobile-rankings', 'expert-boards'], [expertBoard])
    const src: ExpertsSource = {
      rows: [
        { player: p('c', 'Chase Brown'), score: -1 },
        { player: p('a', 'Aaron Jones'), score: -2 },
        { player: p('n', 'New Back'), score: -3 },
      ],
      ranks: new Map(),
      experts: 1,
      updatedAt: STAMP,
      movement,
    }
    qc.setQueryData(['mobile-rankings', 'source', 'experts', 'RB', 'e1-rb'], src)
    return qc
  }

  it('on the experts’ ranking: ▲ / ▼ / New under the rank, ON by default with a switch', () => {
    const movement = new Map<string, Movement>([
      ['c', 2],
      ['a', -1],
      ['n', 'new'],
    ])
    const html = hub({ view: 'hub', src: 'experts', pos: 'RB' }, withExperts(movement))
    expect(html).toMatch(/role="switch" aria-checked="true"[^>]*>Show movement/)
    const t = text(html)
    expect(t).toContain('▲2')
    expect(t).toContain('▼1')
    expect(t).toContain('New')
    expect(t).toContain('up 2 since the last update')
  })

  it('no previous update to compare with: no arrows and no switch', () => {
    const html = hub({ view: 'hub', src: 'experts', pos: 'RB' }, withExperts(new Map()))
    expect(html).not.toContain('Show movement')
    expect(text(html)).not.toMatch(/[▲▼]/)
  })

  it('your own ranking in the editor: the switch is there, OFF by default', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(mobileRankingBoardsKey('u1'), {
      ...BOARDS,
      season: {
        listId: 'season',
        week: 0,
        players: [{ ...row('season', 1, 'Bijan Robinson', 'RB'), previous_position: 2 }],
      },
    } satisfies MyRankingBoards)
    const html = render(
      createElement(RankingEditor, {
        type: 'season',
        pos: 'RB',
        from: null,
        currentWeek: CURRENT_WEEK,
        promptSeq: 0,
        onDirtyChange: () => {},
        onBack: () => {},
        onPublished: () => {},
      }),
      qc,
    )
    expect(html).toMatch(/role="switch" aria-checked="false"[^>]*>Show movement/)
  })

  it('a published ranking with no previous update stored has no switch (nothing to show)', () => {
    // This week's WR ranking was never republished since movement was
    // recorded (or 190 isn't pushed): its rows carry no previous position.
    const html = render(
      createElement(RankingEditor, {
        type: 'w6',
        pos: 'WR',
        from: null,
        currentWeek: CURRENT_WEEK,
        promptSeq: 0,
        onDirtyChange: () => {},
        onBack: () => {},
        onPublished: () => {},
      }),
    )
    expect(html).toContain('Scoring: Half PPR')
    expect(html).not.toContain('Show movement')
  })

  it('a ranking with nothing published at the position has no switch', () => {
    const html = render(
      createElement(RankingEditor, {
        type: 'w8',
        pos: 'RB',
        from: null,
        currentWeek: CURRENT_WEEK,
        promptSeq: 0,
        onDirtyChange: () => {},
        onBack: () => {},
        onPublished: () => {},
      }),
    )
    expect(html).not.toContain('Show movement')
  })
})

describe('the scoring a ranking is published for (Chris, 2026-10-15, #36)', () => {
  const editor = (boards: MyRankingBoards) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(mobileRankingBoardsKey('u1'), boards)
    return render(
      createElement(RankingEditor, {
        type: 'w6',
        pos: 'WR',
        from: null,
        currentWeek: CURRENT_WEEK,
        promptSeq: 0,
        onDirtyChange: () => {},
        onBack: () => {},
        onPublished: () => {},
      }),
      qc,
    )
  }

  it('the editor shows the board’s saved scoring', () => {
    const boards: MyRankingBoards = {
      ...BOARDS,
      weeks: BOARDS.weeks.map((w) => (w.week === 6 ? { ...w, scoringFormat: 'quarter' } : w)),
    }
    expect(editor(boards)).toMatch(/aria-label="Scoring: 0\.25 PPR"/)
  })

  it('with none saved, Half PPR (Chris, 2026-10-16)', () => {
    expect(editor(BOARDS)).toMatch(/aria-label="Scoring: Half PPR"/)
  })

  it('a week with no board yet starts as Half PPR too', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(mobileRankingBoardsKey('u1'), BOARDS)
    const html = render(
      createElement(RankingEditor, {
        type: 'w8',
        pos: 'RB',
        from: null,
        currentWeek: CURRENT_WEEK,
        promptSeq: 0,
        onDirtyChange: () => {},
        onBack: () => {},
        onPublished: () => {},
      }),
      qc,
    )
    expect(html).toMatch(/aria-label="Scoring: Half PPR"/)
  })
})
