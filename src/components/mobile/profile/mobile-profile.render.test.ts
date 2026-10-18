/**
 * Mobile Profile's identity block (gap list §3 #21) rendered over a seeded
 * query cache: the bio under the handle, Following beside Followers, and the
 * slim Cred card (Scout tier, cred and the bar to the next tier) from the
 * stored cred score.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/profile',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  useSearchParams: () => new URLSearchParams(),
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

import { MobileProfile } from './mobile-profile'

const BASE = { ...me.profile }
afterEach(() => {
  Object.assign(me.profile, BASE)
  flags.leagues = true
})

const LEAGUES = [
  { id: 'A', name: 'Sunday Funday League', avatar_url: null, season: 2099, status: 'in_season', team_count: 8, created_at: null, my_role: 'commissioner', my_team_id: 't1' },
  { id: 'B', name: 'Joy to Us', avatar_url: null, season: 2099, status: 'setup', team_count: 12, created_at: null, my_role: 'manager', my_team_id: 'u1' },
]

function render() {
  const qc = new QueryClient()
  qc.setQueryData(leaguesKeys.all, LEAGUES)
  qc.setQueryData(['mobile-profile', 'titles', ['A', 'B'], ['t1', 'u1']], 1)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MobileProfile)))
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

  it('a new account starts at the first tier with an empty bar; no score reads as 0', () => {
    me.profile.cred_score = null
    const out = render()
    expect(textOf(out, 'data-profile-cred')).toBe('Freshie 0 cred Scout tier 1 of 10 100 to Sophomore')
    expect(bar(out)).toContain('aria-valuenow="0"')
  })

  it('the top tier fills the bar and says so', () => {
    me.profile.cred_score = 9400
    const out = render()
    expect(textOf(out, 'data-profile-cred')).toBe('GOAT 9,400 cred Scout tier 10 of 10 Top tier')
    expect(bar(out)).toContain('aria-valuenow="100"')
    expect(bar(out)).toContain('aria-label="Top tier reached"')
  })
})
