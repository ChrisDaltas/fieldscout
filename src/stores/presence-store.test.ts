/**
 * presence-store.test.ts — who's online (gap list §3 #25): the store the
 * session's PresenceHost writes and every green dot reads, plus the team
 * lookup the league rows use.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { teamOnlineLookup } from '@/hooks/use-online'

import {
  isOnlineIn,
  isPresenceLeague,
  leagueIdInPath,
  onlineUnion,
  presenceLeagueId,
  usePresenceStore,
} from './presence-store'

afterEach(() => {
  usePresenceStore.setState({ byLeague: {}, recentLeagueId: null })
})

describe('the presence store', () => {
  it('keeps each league’s people, de-duplicated and sorted', () => {
    usePresenceStore.getState().setLeague('L1', ['u-nina', 'u-marcus', 'u-nina'])
    expect(usePresenceStore.getState().byLeague).toEqual({ L1: ['u-marcus', 'u-nina'] })
  })

  it('a sync that changes nobody leaves the state as it was (no re-render)', () => {
    usePresenceStore.getState().setLeague('L1', ['u-nina', 'u-marcus'])
    const before = usePresenceStore.getState().byLeague
    usePresenceStore.getState().setLeague('L1', new Set(['u-marcus', 'u-nina']))
    expect(usePresenceStore.getState().byLeague).toBe(before)
  })

  it('a league you leave takes its people with it', () => {
    usePresenceStore.getState().setLeague('L1', ['u-nina'])
    usePresenceStore.getState().setLeague('L2', ['u-marcus'])
    usePresenceStore.getState().clearLeague('L1')
    expect(usePresenceStore.getState().byLeague).toEqual({ L2: ['u-marcus'] })
    const before = usePresenceStore.getState().byLeague
    usePresenceStore.getState().clearLeague('L-unknown')
    expect(usePresenceStore.getState().byLeague).toBe(before)
  })

  it('online is any shared league seeing them; nobody and unknown ids are offline', () => {
    const byLeague = { L1: ['u-nina'], L2: ['u-marcus', 'u-nina'] }
    expect(isOnlineIn(byLeague, 'u-marcus')).toBe(true)
    expect(isOnlineIn(byLeague, 'u-nina')).toBe(true)
    expect(isOnlineIn(byLeague, 'u-stranger')).toBe(false)
    expect(isOnlineIn(byLeague, null)).toBe(false)
    expect(isOnlineIn({}, 'u-nina')).toBe(false)
    expect([...onlineUnion(byLeague)].sort()).toEqual(['u-marcus', 'u-nina'])
  })

  it('the host never puts you in it — your own avatar shows no dot', () => {
    const host = readFileSync(path.resolve(process.cwd(), 'src/components/layout/presence-host.tsx'), 'utf8')
    expect(host).toContain('setLeague(leagueId, [...userIds].filter((id) => id !== viewerId))')
    expect(host).toContain('tracksPresence: true')
    // It reads presence through the shared spine — it opens no channel itself.
    expect(host).not.toContain('.channel(')
    expect(host).toContain('joinLeagueRoom(leagueId, {')
  })
})

describe('one league room per session — the current league (spec §9.3)', () => {
  // GET /api/leagues order: newest first.
  const leagues = [
    { id: 'L-new', status: 'setup' },
    { id: 'L-live', status: 'in_season' },
    { id: 'L-old', status: 'complete' },
  ]
  const pick = (pathname: string, mode: 'desktop' | 'mobile' | null, recentLeagueId: string | null = null) =>
    presenceLeagueId({ pathname, mode, recentLeagueId, leagues })

  it('on a league’s pages it is that league, on either layout', () => {
    for (const mode of ['desktop', 'mobile', null] as const) {
      expect(pick('/app/leagues/L-live', mode)).toBe('L-live')
      expect(pick('/app/leagues/L-live/team/t1', mode)).toBe('L-live')
      expect(pick('/app/leagues/L-new/standings', mode, 'L-live')).toBe('L-new')
    }
  })

  it('someone inside the draft room is counted on the draft’s league', () => {
    // The (room) layout's host reads the same path: the drafter is "here"
    // in the league beside the draft's own channel, so they are online on
    // every other screen too.
    expect(pick('/app/leagues/L-live/draft', 'desktop')).toBe('L-live')
    expect(pick('/app/leagues/L-live/draft', 'mobile', 'L-new')).toBe('L-live')
    expect(pick('/app/leagues/L-live/draft?draft=d1', 'mobile')).toBe('L-live')
  })

  it('off league pages a phone keeps the league you were last in', () => {
    expect(pick('/app/messages', 'mobile', 'L-live')).toBe('L-live')
    expect(pick('/app/lists', 'mobile', 'L-live')).toBe('L-live')
    // …else your newest league still in play.
    expect(pick('/app', 'mobile')).toBe('L-new')
    expect(pick('/app/leagues', 'mobile')).toBe('L-new')
  })

  it('off league pages desktop holds no league room at all', () => {
    expect(pick('/app', 'desktop', 'L-live')).toBeNull()
    expect(pick('/app/lists', 'desktop', 'L-live')).toBeNull()
    expect(pick('/app/mocks/m1', 'desktop', 'L-live')).toBeNull()
    expect(pick('/app', null, 'L-live')).toBeNull()
  })

  it('a finished season is never held — its own pages hold none, and it is never a fallback', () => {
    expect(isPresenceLeague('complete')).toBe(false)
    for (const status of ['setup', 'scheduled', 'drafting', 'in_season', 'playoffs']) expect(isPresenceLeague(status)).toBe(true)
    expect(pick('/app/leagues/L-old', 'mobile', 'L-live')).toBeNull()
    expect(pick('/app/lists', 'mobile', 'L-old')).toBe('L-new')
    expect(presenceLeagueId({ pathname: '/app', mode: 'mobile', recentLeagueId: null, leagues: [{ id: 'L-old', status: 'complete' }] })).toBeNull()
  })

  it('a remembered league you are no longer in (or another account’s) is ignored', () => {
    expect(pick('/app/messages', 'mobile', 'L-gone')).toBe('L-new')
  })

  it('a /app/leagues path that is not one of your leagues is not a league page', () => {
    expect(pick('/app/leagues/new', 'mobile', 'L-live')).toBe('L-live')
    expect(pick('/app/leagues/new', 'desktop', 'L-live')).toBeNull()
    expect(presenceLeagueId({ pathname: '/app/leagues/L-live', mode: 'mobile', recentLeagueId: null, leagues: [] })).toBeNull()
  })

  it('reads the league id out of a path', () => {
    expect(leagueIdInPath('/app/leagues/abc')).toBe('abc')
    expect(leagueIdInPath('/app/leagues/abc/draft')).toBe('abc')
    expect(leagueIdInPath('/app/leagues')).toBeNull()
    expect(leagueIdInPath('/app/messages')).toBeNull()
  })

  it('remembers the last league without re-rendering on a repeat', () => {
    usePresenceStore.getState().setRecentLeague('L-live')
    const before = usePresenceStore.getState()
    usePresenceStore.getState().setRecentLeague('L-live')
    expect(usePresenceStore.getState()).toBe(before)
    expect(usePresenceStore.getState().recentLeagueId).toBe('L-live')
  })

  it('the host holds the one picked league, never a map over every league', () => {
    const host = readFileSync(path.resolve(process.cwd(), 'src/components/layout/presence-host.tsx'), 'utf8')
    expect(host).toContain('presenceLeagueId({')
    expect(host).not.toMatch(/leagues\.data \?\? \[\]\)\.map/)
    expect(host.match(/<LeaguePresence /g)).toHaveLength(1)
  })
})

describe('a team is online through its manager', () => {
  const members = [
    { user_id: 'u-me', team_id: 'team-me' },
    { user_id: 'u-marcus', team_id: 'team-marcus' },
    { user_id: null, team_id: 'team-open' },
    { user_id: 'u-co', team_id: null },
  ]

  it('lights the team whose manager is online, and nothing else', () => {
    const online = teamOnlineLookup(members, new Set(['u-marcus', 'u-co']))
    expect(online('team-marcus')).toBe(true)
    expect(online('team-me')).toBe(false)
    // An open seat has nobody to be online; a member with no team lights none.
    expect(online('team-open')).toBe(false)
    expect(online(null)).toBe(false)
    expect(online(undefined)).toBe(false)
  })
})

function sourceFiles(dir = 'src'): string[] {
  const out: string[] = []
  for (const entry of readdirSync(path.resolve(process.cwd(), dir))) {
    const rel = `${dir}/${entry}`
    if (statSync(path.resolve(process.cwd(), rel)).isDirectory()) out.push(...sourceFiles(rel))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(rel)
  }
  return out
}

describe('mounted once per frame — the app shell and the draft room', () => {
  it('the shell and the (room) layout each render one PresenceHost; no screen or row does', () => {
    // The two frames are sibling route groups, so exactly one is mounted at a
    // time — and without the room's, a manager who is drafting reads offline.
    const hosts = sourceFiles().filter((rel) => readFileSync(path.resolve(process.cwd(), rel), 'utf8').includes('<PresenceHost'))
    expect(hosts.sort()).toEqual(['src/app/app/(room)/layout.tsx', 'src/components/layout/app-shell.tsx'])
    for (const rel of hosts) {
      expect(readFileSync(path.resolve(process.cwd(), rel), 'utf8').match(/<PresenceHost \/>/g), rel).toHaveLength(1)
    }
  })

  it('nothing but the host asks to be counted as here', () => {
    const asking = sourceFiles().filter((rel) => /tracksPresence: true/.test(readFileSync(path.resolve(process.cwd(), rel), 'utf8')))
    expect(asking).toEqual(['src/components/layout/presence-host.tsx'])
  })
})
