/**
 * Feed parsing against REAL samples saved 2026-10-18 (trimmed to 8 items):
 * ESPN, CBS, Yahoo, ProFootballTalk, RotoWire RSS and one Bluesky
 * getAuthorFeed page (Ian Rapoport).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildIndex, matchPlayers } from './match'
import { parseBluesky, parseRss, plainText, safeUrl } from './parse'
import { BLUESKY_SOURCES, RSS_SOURCES } from './sources'

const fx = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')
const rss = (key: string) => RSS_SOURCES.find((s) => s.key === key)!

describe('parseRss — real feeds', () => {
  it.each(['espn', 'cbs', 'yahoo', 'pft', 'rotowire'])('%s parses into plain-text items with http(s) links and dates', (key) => {
    const items = parseRss(fx(`${key}.xml`), rss(key))
    expect(items.length).toBeGreaterThanOrEqual(5)
    for (const i of items) {
      expect(i.source_key).toBe(key)
      expect(i.headline).not.toMatch(/<|>|&(amp|quot|#39);/)
      expect(i.url).toMatch(/^https?:\/\//)
      expect(i.external_id.length).toBeGreaterThan(0)
      expect(i.published_at === null || !Number.isNaN(Date.parse(i.published_at))).toBe(true)
    }
    expect(items.filter((i) => i.published_at !== null).length).toBeGreaterThan(0)
  })

  it('ESPN: CDATA headline, exact stored literal', () => {
    const items = parseRss(fx('espn.xml'), rss('espn'))
    expect(items[0].headline).toBe('Follow live: Jordan Love finds Matthew Golden for TD as Packers strike first')
  })

  it("Yahoo: entities decode to plain text (&#39; → ')", () => {
    const h = parseRss(fx('yahoo.xml'), rss('yahoo')).map((i) => i.headline)
    expect(h).toContain("Jim Harbaugh on Mike McDaniel: We'll look at everything, offense needs to be addressed")
  })

  it('RotoWire: a player-titled update matches its player', () => {
    const items = parseRss(fx('rotowire.xml'), rss('rotowire'))
    const index = buildIndex([{ id: 'nabers', full_name: 'Malik Nabers', team: 'NYG' }])
    expect(matchPlayers(items[0].match_text, index)).toEqual([{ player_id: 'nabers', rule: 'unique_name' }])
  })

  it('an empty or non-XML body is no items, never a throw', () => {
    expect(parseRss('<!DOCTYPE html><html></html>', rss('espn'))).toEqual([])
    expect(parseRss('', rss('espn'))).toEqual([])
  })
})

describe('parseBluesky — real getAuthorFeed page', () => {
  const src = BLUESKY_SOURCES.find((s) => s.handle === 'rapsheet.bsky.social')!
  const items = parseBluesky(JSON.parse(fx('bsky-rapsheet.json')), src)

  it('posts → items labelled with the reporter, linking out to bsky.app', () => {
    expect(items.length).toBeGreaterThanOrEqual(4)
    expect(items[0]).toMatchObject({
      source_key: 'bsky:rapsheet.bsky.social',
      source_label: 'Ian Rapoport',
      external_id: 'at://did:plc:hlvr2omhnmvdmfnvmcuhyevz/app.bsky.feed.post/3my6rl4l63k2a',
      url: 'https://bsky.app/profile/rapsheet.bsky.social/post/3my6rl4l63k2a',
      published_at: '2026-10-18T23:37:41.373Z',
    })
  })

  it('"Giants QB J.J. McCarthy" matches by name + team', () => {
    const index = buildIndex([
      { id: 'mccarthy', full_name: 'J.J. McCarthy', team: 'NYG' },
      { id: 'mccarthy2', full_name: 'J.J. McCarthy', team: 'MIN' },
    ])
    expect(matchPlayers(items[0].match_text, index)).toEqual([{ player_id: 'mccarthy', rule: 'name_team' }])
  })

  it('reposts and other authors are skipped; junk is no items', () => {
    const post = { uri: 'at://x/app.bsky.feed.post/abc', author: { handle: src.handle }, record: { text: 'hi', createdAt: '2026-10-18T00:00:00Z' } }
    expect(parseBluesky({ feed: [{ post, reason: { $type: 'repost' } }] }, src)).toEqual([])
    expect(parseBluesky({ feed: [{ post: { ...post, author: { handle: 'someone.else' } } }] }, src)).toEqual([])
    expect(parseBluesky(null, src)).toEqual([])
    expect(parseBluesky({ error: 'InvalidRequest' }, src)).toEqual([])
  })
})

describe('plainText / safeUrl', () => {
  it('strips tags and control characters, caps length', () => {
    expect(plainText('<b>Hi</b>\u0007 &#8217;there&#x21;')).toBe('Hi ’there!')
    expect(plainText('x'.repeat(400)).length).toBe(300)
  })
  it('only http(s) links survive', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('data:text/html,hi')).toBeNull()
    expect(safeUrl('/relative')).toBeNull()
    expect(safeUrl('https://www.espn.com/a')).toBe('https://www.espn.com/a')
  })
})
