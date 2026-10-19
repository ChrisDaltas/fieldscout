/**
 * The YouTube play mark is monochrome — never red (Chris, 2026-10-18, asked
 * whether the red play logos on video thumbnails could stay: "ideally youtube
 * logos are white or black depending"). Pinned:
 *  - over a thumbnail (or the dark box a video without one shows) the mark is
 *    WHITE with a black play and a soft dark halo, on both video cards — the
 *    List view's and the Community detail's;
 *  - on a plain surface with no thumbnail (the Edit details link field) it is
 *    BLACK (`m-t1`) with a page-coloured play, and those phone tokens flip in
 *    phone dark mode, so it turns white there;
 *  - the halo is a token (`shadow-m-on-media`), a dark one;
 *  - no play mark anywhere on the phone is filled with the bright red (the
 *    fill guard is `ui/system-message-rule.test.ts`; this pins the mark).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import postcss, { type Declaration, type Rule } from 'postcss'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/feature-flags', () => ({ featureFlags: { weeklyRanks: true, personas: false } }))

import { VideoCard as CommunityVideoCard } from '@/components/mobile/community/community-detail'

import { VideoCard, YouTubeBadge } from './lists-parts'

import tailwindConfig from '../../../../tailwind.config'

const html = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/** The opening tag of the (single) YouTube mark in `out`. */
function markTag(out: string): string {
  const marks = out.match(/<span[^>]*data-youtube-mark="[^"]*"[^>]*>/g) ?? []
  expect(marks, 'exactly one YouTube mark').toHaveLength(1)
  return marks[0]!
}

/** No spelling of the bright red, as a fill or as a glyph colour. */
const RED = /negative-strong|destructive|m-red|#ff0028|255[,_\s]+0[,_\s]+40/i

const WHITE_MARK = ['data-youtube-mark="media"', 'bg-white', 'text-black', 'shadow-m-on-media']
const BLACK_MARK = ['data-youtube-mark="surface"', 'bg-m-t1', 'text-m-b0']

describe('the YouTube play mark is white or black, never red', () => {
  it('List view video card: a WHITE mark over the thumbnail (32×22)', () => {
    const out = html(createElement(VideoCard, { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Week 5 waivers' }))
    expect(out).toContain('i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    const mark = markTag(out)
    for (const cls of WHITE_MARK) expect(mark, cls).toContain(cls)
    expect(mark).toContain('h-[22px] w-8')
    // Still centred on the thumbnail.
    expect(mark).toContain('absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2')
    expect(out).not.toMatch(RED)
  })

  it('a video with no thumbnail sits on the dark ink box — the mark stays white', () => {
    const out = html(createElement(VideoCard, { url: 'https://vimeo.com/1', title: null, sub: 'Vimeo' }))
    expect(out).not.toContain('i.ytimg.com')
    expect(out).toContain('bg-m-ink')
    const mark = markTag(out)
    for (const cls of WHITE_MARK) expect(mark, cls).toContain(cls)
    expect(out).not.toMatch(RED)
  })

  it('Community detail video card: a WHITE mark over the thumbnail (40×28)', () => {
    const out = html(
      createElement(CommunityVideoCard, {
        video: { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Week 5 waivers', duration: '14:02', source: null },
      }),
    )
    expect(out).toContain('i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    const mark = markTag(out)
    for (const cls of WHITE_MARK) expect(mark, cls).toContain(cls)
    expect(mark).toContain('h-7 w-10 rounded-[8px]')
    expect(out).not.toMatch(RED)
  })

  it('on a plain surface (the link field) the mark is BLACK, 20×14', () => {
    const out = html(createElement(YouTubeBadge))
    const mark = markTag(out)
    for (const cls of BLACK_MARK) expect(mark, cls).toContain(cls)
    expect(mark).toContain('h-3.5 w-5 rounded-sm')
    expect(mark).not.toContain('bg-white')
    expect(out).not.toMatch(RED)
  })

  it('Edit details puts the surface (black) mark in its link field', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/components/mobile/lists/list-details-screen.tsx'), 'utf8')
    const field = src.slice(src.indexOf('<YouTubeBadge'), src.indexOf('aria-label="YouTube link"'))
    expect(field.length, 'the link field’s YouTubeBadge').toBeGreaterThan(10)
    expect(field).toMatch(/^<YouTubeBadge \/>/) // default = on a surface
    expect(src).toContain('rounded-xl bg-m-b2 px-3') // ...and that surface is the plain field
  })

  it('the surface mark flips to white in phone dark mode (m-t1 / m-b0 swap)', () => {
    const css = postcss.parse(readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8'))
    const varIn = (selector: string, prop: string) => {
      let value: string | undefined
      css.walkDecls(prop, (d: Declaration) => {
        if ((d.parent as Rule).selector === selector) value = d.value.trim()
      })
      return value
    }
    const sum = (rgb: string | undefined) => (rgb ?? '').split(/\s+/).reduce((n, c) => n + Number(c), 0)
    const DARK = "html[data-theme='dark']"
    // Light: a dark mark with a light play; dark mode: white mark, dark play.
    expect(sum(varIn(':root', '--m-t1'))).toBeLessThan(150)
    expect(sum(varIn(':root', '--m-b0'))).toBeGreaterThan(700)
    expect(varIn(DARK, '--m-t1')).toBe('255 255 255')
    expect(sum(varIn(DARK, '--m-b0'))).toBeLessThan(150)
  })

  it('the halo is a dark token, not a coloured fill', () => {
    const shadows = (tailwindConfig.theme?.extend as { boxShadow: Record<string, string> }).boxShadow
    const halo = shadows['m-on-media']
    expect(halo, 'boxShadow m-on-media').toBeDefined()
    // Every colour in it is black at some alpha.
    const colours = halo!.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/gi) ?? []
    expect(colours.length).toBeGreaterThan(0)
    for (const c of colours) expect(c, c).toMatch(/^rgba\(0,\s*0,\s*0,\s*\.?\d+\)$/)
  })

  it('no phone play mark is bright red', () => {
    for (const file of [
      'src/components/mobile/lists/lists-parts.tsx',
      'src/components/mobile/community/community-detail.tsx',
      'src/components/mobile/community/community-cards.tsx',
      'src/components/mobile/lists/lists-grid.tsx',
    ]) {
      const src = readFileSync(path.join(process.cwd(), file), 'utf8')
      expect(src, file).not.toMatch(/bg-(?:negative-strong|destructive|m-red)\b/)
    }
  })
})
