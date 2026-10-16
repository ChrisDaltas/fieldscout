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

import { MyRankingsBody } from './my-rankings'
import { NewRanking } from './new-ranking'
import { RankingEditor } from './ranking-editor'
import type { RankingsNav } from './rankings-hub'
import type { RankFrom, RankPos, RankType } from './rankings-ops'

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
        scoring: 'ppr',
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
