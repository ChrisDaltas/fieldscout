/**
 * Desktop Details tab — Attached links when a video has NO title.
 *
 * Chris, 2026-10-15: "we need the actual YouTube titles or nothing. Having a
 * bunch of videos with the same title is useless." A video attached on a
 * phone whose title YouTube would not give is stored with title NULL
 * (migration 189). This tab (also the public share page's read-only view)
 * must show no title text for it — never a placeholder — while the row keeps
 * its real facts (source / duration, else the address) as the link.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ListWithDetails } from '@/hooks/use-lists'

import { ListDetailsTab } from './list-details-tab'

const html = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

function list(links: Array<Record<string, unknown>>): ListWithDetails {
  return {
    id: 'l1',
    title: 'My top 5 QBs',
    description: null,
    players: [],
    tags: [],
    links: links.map((link, i) => ({
      id: `k${i}`,
      list_id: 'l1',
      kind: 'video',
      source_label: null,
      duration_label: null,
      position: i,
      ...link,
    })),
  } as unknown as ListWithDetails
}

/** The `<li>` that links to `url`. */
function row(out: string, url: string): string {
  const at = out.indexOf(`href="${url}"`)
  expect(at, url).toBeGreaterThan(-1)
  return out.slice(out.lastIndexOf('<li', at), out.indexOf('</li>', at) + 5)
}

describe('ListDetailsTab — a link with no title', () => {
  it('read-only (the public share page): the address is the link, no title text, no placeholder', () => {
    const out = html(createElement(ListDetailsTab, { list: list([{ url: VIDEO, title: null }]), canEdit: false }))
    const li = row(out, VIDEO)
    expect(li).toContain(`>${VIDEO}</a>`)
    // One line, not a bold title over an empty or repeated second line.
    expect(li).not.toContain('font-semibold text-ink')
    expect(li.match(/<a /g)).toHaveLength(1)
    expect(li).not.toMatch(/<(a|span)[^>]*><\/(a|span)>/)
    expect(out).not.toMatch(/youtube video/i)
  })

  it('real source and duration stand in as the line when they exist — still no title', () => {
    const out = html(
      createElement(ListDetailsTab, {
        list: list([{ url: VIDEO, title: null, source_label: 'Field Scout on YouTube', duration_label: '18:42' }]),
        canEdit: false,
      }),
    )
    expect(row(out, VIDEO)).toContain('>Field Scout on YouTube · 18:42</a>')
    expect(out).not.toMatch(/youtube video/i)
  })

  it('the owner’s remove control is named by the row’s real facts', () => {
    const out = html(
      createElement(ListDetailsTab, {
        list: list([{ url: VIDEO, title: null }]),
        canEdit: true,
        onRemoveLink: () => {},
      }),
    )
    expect(row(out, VIDEO)).toContain(`aria-label="Remove ${VIDEO}"`)
    expect(out).not.toMatch(/youtube video/i)
  })

  it('a titled link is unchanged: bold title link over the source line', () => {
    const out = html(
      createElement(ListDetailsTab, {
        list: list([{ url: VIDEO, title: 'Round 1 walkthrough', source_label: 'Field Scout on YouTube' }]),
        canEdit: true,
        onRemoveLink: () => {},
      }),
    )
    const li = row(out, VIDEO)
    expect(li).toContain('>Round 1 walkthrough</a>')
    expect(li).toContain('>Field Scout on YouTube</span>')
    expect(li).toContain('aria-label="Remove Round 1 walkthrough"')
  })
})

/**
 * Chris, 2026-10-18: "ideally youtube logos are white or black depending."
 * The desktop row has no thumbnail and sits on white, so a video's mark is
 * BLACK (ink) with a white play — it was a red-tinted (`tier-2`) tile with a
 * chevron. An article keeps its own tile.
 */
describe('ListDetailsTab — a video’s mark is black, never red', () => {
  const ARTICLE = 'https://example.com/waivers'
  const out = html(
    createElement(ListDetailsTab, {
      list: list([
        { url: VIDEO, title: 'Round 1 walkthrough' },
        { url: ARTICLE, title: 'Waiver notes', kind: 'article' },
      ]),
      canEdit: false,
    }),
  )

  it('the video row: an ink tile with a white play glyph', () => {
    const li = row(out, VIDEO)
    const mark = li.match(/<span[^>]*data-video-mark[^>]*>/)?.[0]
    expect(mark, 'the video mark').toBeDefined()
    expect(mark).toContain('bg-ink text-white')
    expect(li).toContain('d="M4.5 2.8v10.4L13 8z"') // the play
    expect(li).not.toMatch(/tier-2|negative-strong|destructive|m-red/)
  })

  it('an article row keeps its tinted document tile and no video mark', () => {
    const li = row(out, ARTICLE)
    expect(li).not.toContain('data-video-mark')
    expect(li).toContain('bg-tier-4/50 text-ink')
    expect(li).not.toContain('d="M4.5 2.8v10.4L13 8z"')
  })
})
