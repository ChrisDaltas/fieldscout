/**
 * Mobile Profile rendered over a seeded query cache:
 *  - the identity block (gap list §3 #21): the bio under the handle,
 *    Following beside Followers, and the slim Cred card (Scout tier, cred
 *    and the bar to the next tier) from the stored cred score;
 *  - My stuff › Rankings (gap list §3 #22): one row per position ranking,
 *    marked Published or Finalized, each opening that ranking.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const search = vi.hoisted(() => ({ query: '' }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/profile',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  useSearchParams: () => new URLSearchParams(search.query),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ from: () => ({}) }),
}))
const flags = vi.hoisted(() => ({ leagues: true, weeklyRanks: true, startOrSit: true }))
vi.mock('@/lib/feature-flags', () => ({ featureFlags: flags }))

const me = vi.hoisted(() => ({
  profile: {
    id: 'user-me',
    username: 'dalton',
    avatar_url: null as string | null,
    bio: 'Zero-RB truther.\nTight ends are people too.' as string | null,
    cred_score: 340 as number | null,
    follower_count: 41,
    following_count: 12,
  },
}))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-me' }, profile: me.profile, isLoading: false }),
}))

import { leaguesKeys } from '@/hooks/use-leagues'
import { mobileRankingBoardsKey, type BoardPlayerLite, type MyRankingBoards } from '@/hooks/use-mobile-rankings-boards'

import { MobileProfile } from './mobile-profile'

const BASE = { ...me.profile }
afterEach(() => {
  Object.assign(me.profile, BASE)
  flags.leagues = true
  search.query = ''
})

const LEAGUES = [
  { id: 'A', name: 'Sunday Funday League', avatar_url: null, season: 2099, status: 'in_season', team_count: 8, created_at: null, my_role: 'commissioner', my_team_id: 't1' },
  { id: 'B', name: 'Joy to Us', avatar_url: null, season: 2099, status: 'setup', team_count: 12, created_at: null, my_role: 'manager', my_team_id: 'u1' },
]

function render(seed?: (qc: QueryClient) => void) {
  const qc = new QueryClient()
  qc.setQueryData(leaguesKeys.all, LEAGUES)
  qc.setQueryData(['mobile-profile', 'titles', ['A', 'B'], ['t1', 'u1']], 1)
  seed?.(qc)
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(MobileProfile, { currentWeek: 6 })),
  )
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

/** The Cred card's progress bar's opening tag (its aria attributes). */
function bar(html: string): string {
  const tag = html.match(/<div[^>]*role="progressbar"[^>]*>/)
  expect(tag, 'progressbar').not.toBeNull()
  return tag![0]
}

/** The visible text of the element carrying `attr`, tags stripped. */
function textOf(html: string, attr: string): string {
  const start = html.indexOf(attr)
  expect(start, attr).toBeGreaterThan(-1)
  const open = html.lastIndexOf('<', start)
  const tag = html.slice(open + 1).match(/^\w+/)![0]
  // Walk to the matching close tag (the blocks here nest their own tag).
  let depth = 0
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g')
  re.lastIndex = open
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    depth += m[0].startsWith('</') ? -1 : 1
    if (depth === 0) return html.slice(open, m.index).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  throw new Error(`unclosed ${tag}`)
}

describe('mobile Profile — bio, Following and the Cred card (gap list §3 #21)', () => {
  it('shows the bio under the handle, before the stats, keeping its line breaks', () => {
    const out = render()
    const handle = out.indexOf('@dalton')
    const bio = out.indexOf('data-profile-bio')
    const stats = out.indexOf('Followers')
    expect(handle).toBeGreaterThan(-1)
    expect(bio).toBeGreaterThan(handle)
    expect(stats).toBeGreaterThan(bio)
    expect(out).toContain('Zero-RB truther.\nTight ends are people too.')
    expect(out).toMatch(/<p[^>]*whitespace-pre-line[^>]*data-profile-bio/)
  })

  it('shows no bio block when there is none (empty, blank or null)', () => {
    for (const bio of [null, '', '   \n ']) {
      me.profile.bio = bio
      expect(render()).not.toContain('data-profile-bio')
    }
  })

  it('keeps Following beside Followers, then Titles while leagues are on', () => {
    const out = render()
    const labels = [...out.matchAll(/text-\[11px\] font-medium text-m-t3">(Followers|Following|Titles|Cred score)</g)].map((m) => m[1])
    expect(labels).toEqual(['Followers', 'Following', 'Titles'])
    expect(out).toContain('mt-4 grid gap-2 grid-cols-3')
    // The real counts.
    expect(out).toMatch(/>41<\/span><span[^>]*>Followers</)
    expect(out).toMatch(/>12<\/span><span[^>]*>Following</)
    expect(out).toMatch(/>1<\/span><span[^>]*>Titles</)
  })

  it('with leagues off the two social cards share the row — no Titles', () => {
    flags.leagues = false
    const out = render()
    const labels = [...out.matchAll(/text-\[11px\] font-medium text-m-t3">(Followers|Following|Titles|Cred score)</g)].map((m) => m[1])
    expect(labels).toEqual(['Followers', 'Following'])
    expect(out).toContain('mt-4 grid gap-2 grid-cols-2')
    expect(out).not.toContain('2 leagues')
  })

  it('the Cred card shows the Scout tier, the cred, the bar and what is left to the next tier', () => {
    const out = render()
    expect(textOf(out, 'data-profile-cred')).toBe('JV 340 cred Scout tier 3 of 10 260 to Varsity')
    // The bar: 40 of the 300 between JV (300) and Varsity (600).
    expect(bar(out)).toContain('aria-valuenow="13"')
    expect(bar(out)).toContain('aria-label="Progress to Varsity"')
    // After the stats, before My stuff.
    expect(out.indexOf('data-profile-cred')).toBeGreaterThan(out.indexOf('>Titles<'))
    expect(out.indexOf('data-profile-cred')).toBeLessThan(out.indexOf('My stuff'))
  })

  it('a new account starts at 7 cred on the first tier, 7 of the way to Sophomore (Chris 2026-10-18)', () => {
    me.profile.cred_score = 7
    const out = render()
    expect(textOf(out, 'data-profile-cred')).toBe('Freshie 7 cred Scout tier 1 of 10 93 to Sophomore')
    expect(bar(out)).toContain('aria-valuenow="7"')
  })

  it('no stored score reads as the starting 7, never as 0', () => {
    me.profile.cred_score = null
    const out = render()
    expect(textOf(out, 'data-profile-cred')).toBe('Freshie 7 cred Scout tier 1 of 10 93 to Sophomore')
    expect(bar(out)).toContain('aria-valuenow="7"')
  })

  it('the top tier fills the bar and says so', () => {
    me.profile.cred_score = 9400
    const out = render()
    expect(textOf(out, 'data-profile-cred')).toBe('GOAT 9,400 cred Scout tier 10 of 10 Top tier')
    expect(bar(out)).toContain('aria-valuenow="100"')
    expect(bar(out)).toContain('aria-label="Top tier reached"')
  })
})

// ---------------------------------------------------------------------------
// My stuff › Rankings (gap list §3 #22)
// ---------------------------------------------------------------------------

const RECENT = Date.now()
const at = (hoursAgo: number) => new Date(RECENT - hoursAgo * 3_600_000).toISOString()

function boardRow(listId: string, n: number, pos: string, saved: string): BoardPlayerLite {
  return {
    list_id: listId,
    player_id: `${listId}-${n}`,
    position: n,
    updated_at: saved,
    added_at: saved,
    player: { id: `${listId}-${n}`, full_name: `Player ${n}`, position: pos, team: 'KC', headshot_url: null },
  }
}

/** Season board (WR + RB), a played Week 4 (QB) and this week's board (RB),
 *  with Week 6 saved for PPR. Newest first: W6 RB, season WR, W4 QB, season RB. */
const BOARDS: MyRankingBoards = {
  season: {
    listId: 'season',
    week: 0,
    players: [boardRow('season', 1, 'WR', at(5)), boardRow('season', 2, 'RB', at(24 * 4))],
    scoringFormat: null,
  },
  weeks: [
    { listId: 'w4', week: 4, players: [boardRow('w4', 1, 'QB', at(30))], scoringFormat: 'standard' },
    { listId: 'w6', week: 6, players: [boardRow('w6', 1, 'RB', at(1)), boardRow('w6', 2, 'RB', at(2))], scoringFormat: 'ppr' },
  ],
}

/** The Rankings segment's rows: [href, title, sub, sub classes]. */
function rankingRows(html: string): Array<[string, string, string, string]> {
  return [
    ...html.matchAll(
      /<a [^>]*href="([^"]+)"[^>]*>(?:(?!<a ).)*?<span class="truncate text-\[15px\] font-semibold">([^<]*)<\/span><span class="text-\[12px\] font-medium ([^"]*)">([^<]*)<\/span>/g,
    ),
  ].map((m) => [m[1]!, m[2]!, m[4]!, m[3]!])
}

describe('mobile Profile — My stuff › Rankings rows (gap list §3 #22)', () => {
  const renderRankings = (boards: MyRankingBoards | null) => {
    // Home's Rankings tile's link.
    search.query = 'tab=rankings'
    return render((qc) => {
      if (boards) qc.setQueryData(mobileRankingBoardsKey('user-me'), boards)
    })
  }

  it('one row per position ranking, newest save first, the first three', () => {
    const rows = rankingRows(renderRankings(BOARDS))
    expect(rows.map((r) => r[1])).toEqual([
      'Week 6 · RB · PPR',
      'Rest of season · WR · Half PPR',
      'Week 4 · QB · Standard',
    ])
  })

  it('each row is marked Published or Finalized — a played week is Finalized', () => {
    const rows = rankingRows(renderRankings(BOARDS))
    expect(rows.map((r) => r[2])).toEqual([
      'Published · updated 1h ago',
      'Published · updated 5h ago',
      'Finalized · updated 1d ago',
    ])
    // The design's colours: Submitted green for Published, t4 for Finalized.
    expect(rows.map((r) => r[3])).toEqual(['text-m-green', 'text-m-green', 'text-m-t4'])
    const t = renderRankings(BOARDS)
    expect(t).not.toMatch(/>Saved\b|Saved ·|Draft|Submitted/)
  })

  it('each row opens the ranking you tap — its editor, over the Mine tab', () => {
    const rows = rankingRows(renderRankings(BOARDS))
    expect(rows.map((r) => r[0])).toEqual([
      '/app/weekly-ranks?view=mine&pos=RB&edit=w6&ep=RB',
      '/app/weekly-ranks?view=mine&pos=WR&edit=season&ep=WR',
      '/app/weekly-ranks?view=mine&pos=QB&edit=w4&ep=QB',
    ])
    // See all still opens the Mine tab; the button still opens New ranking.
    const html = renderRankings(BOARDS)
    expect(html).toMatch(/<a [^>]*data-my-stuff-see-all="true" href="\/app\/weekly-ranks\?view=mine">See all</)
    expect(html).toContain('href="/app/weekly-ranks?new=1"')
  })

  it('no rankings yet says so; the read still loading shows the skeleton, not the empty copy', () => {
    expect(renderRankings({ season: null, weeks: [] })).toContain('No rankings yet')
    const loading = renderRankings(null)
    expect(loading).toContain('aria-busy="true"')
    expect(loading).not.toContain('No rankings yet')
  })
})

describe('mobile Profile — My stuff › Start/Sit rows brighten in dark mode (gap list §4 item 6)', () => {
  const player = (id: string, full_name: string) => ({ id, full_name, team: 'SEA', position: 'WR', headshot_url: null })
  const DAY = 86_400_000
  const question = (id: string, closesInMs: number) => ({
    id,
    note: `Question ${id}`,
    season: 2099,
    week: 1,
    votesA: 3,
    votesB: 1,
    closesAt: new Date(Date.now() + closesInMs).toISOString(),
    resolvedAt: null,
    createdAt: new Date(Date.now() - DAY).toISOString(),
    playerA: player(`${id}-a`, 'Marcus Delaney'),
    playerB: player(`${id}-b`, 'Tre Holloway'),
  })

  it('an open question’s line is the phone’s themed green, a closed one t3 — never the fixed light green', () => {
    search.query = 'tab=ss'
    const html = render((qc) => {
      qc.setQueryData(['mobile-profile', 'start-sit', 'user-me'], [question('open', DAY), question('closed', -DAY)])
    })
    const rows = rankingRows(html)
    expect(rows.map((r) => [r[1], r[3]])).toEqual([
      ['Question open', 'text-m-green'],
      ['Question closed', 'text-m-t3'],
    ])
    expect(rows[0]![2]).toMatch(/· Open ·/)
    expect(html).not.toContain('text-positive-strong')
  })
})
