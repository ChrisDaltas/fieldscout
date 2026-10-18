/**
 * presence-store.test.ts — who's online (gap list §3 #25): the store the
 * session's PresenceHost writes and every green dot reads, plus the team
 * lookup the league rows use.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { teamOnlineLookup } from '@/hooks/use-online'

import { isOnlineIn, onlineUnion, usePresenceStore } from './presence-store'

afterEach(() => {
  usePresenceStore.setState({ byLeague: {} })
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

describe('mounted once, in the app shell', () => {
  it('the shell renders the one PresenceHost; no screen or row does', () => {
    const hosts = sourceFiles().filter((rel) => readFileSync(path.resolve(process.cwd(), rel), 'utf8').includes('<PresenceHost'))
    expect(hosts).toEqual(['src/components/layout/app-shell.tsx'])
    const shell = readFileSync(path.resolve(process.cwd(), 'src/components/layout/app-shell.tsx'), 'utf8')
    expect(shell.match(/<PresenceHost \/>/g)).toHaveLength(1)
  })

  it('nothing but the host asks to be counted as here', () => {
    const asking = sourceFiles().filter((rel) => /tracksPresence: true/.test(readFileSync(path.resolve(process.cwd(), rel), 'utf8')))
    expect(asking).toEqual(['src/components/layout/presence-host.tsx'])
  })
})
