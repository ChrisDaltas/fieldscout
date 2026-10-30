/**
 * The shared public list card (in-app /app/u, public /u, /tag, /personas) —
 * its keyboard focus ring (WDO-3). The card's one focusable thing is the
 * title link, inside an `h3` that truncates (overflow: hidden), so a ring on
 * the link itself was clipped away. The ring is drawn on the link's
 * stretched hit area (`::after`, placed against the card, outside the h3's
 * clip, with the card's corners) — and only for the keyboard
 * (`focus-visible`), never at rest, never as a shadow.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-profile-href', () => ({ useProfileHref: (u: string) => `/u/${u}` }))

import { PublicListCard } from './public-list-card'

const render = () =>
  renderToStaticMarkup(
    createElement(PublicListCard, {
      href: '/u/kelly/lists/sleepers',
      title: 'My RB sleepers',
      description: null,
      positionFilter: null,
      playerCount: 12,
      likeCount: 3,
      updatedAt: null,
      owner: { username: 'kelly', avatar_url: null },
      linkOwner: true,
    }),
  )

const titleLink = (out: string) => out.match(/<a[^>]*href="\/u\/kelly\/lists\/sleepers"[^>]*>/)?.[0] ?? ''
const classes = (tag: string) => (tag.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/)

describe('the public list card’s keyboard focus ring (WDO-3)', () => {
  it('the title sits in a truncating h3 — which clips anything drawn outside the text', () => {
    expect(render()).toMatch(/<h3 class="truncate[^"]*"><a /)
  })

  it('the ring is drawn on the stretched hit area (the whole card), with the card’s corners', () => {
    const c = classes(titleLink(render()))
    expect(c).toEqual(
      expect.arrayContaining([
        'after:absolute',
        'after:inset-0',
        'after:rounded-2xl',
        'focus-visible:after:outline',
        'focus-visible:after:outline-2',
        'focus-visible:after:outline-offset-2',
        'focus-visible:after:outline-accent',
      ]),
    )
  })

  it('…not on the clipped link itself, and never at rest', () => {
    const c = classes(titleLink(render()))
    expect(c).toContain('outline-none')
    expect(c.filter((k) => /^focus-visible:outline/.test(k))).toEqual([])
    expect(c.filter((k) => /^(after:)?outline(-|$)/.test(k) && k !== 'outline-none')).toEqual([])
  })

  it('no resting shadow on the card — elevation stays a hover state', () => {
    const out = render()
    const shadows = [...out.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/)).filter((k) => /shadow-/.test(k))
    expect(shadows.every((k) => k.startsWith('hover:'))).toBe(true)
  })
})
