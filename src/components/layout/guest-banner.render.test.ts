/**
 * The signed-out banner on public pages — a shared list or profile opened by
 * a friend who isn't signed in (WDO-7). It promises only what's switched on
 * (plan C4): lists always, rankings only while they're on (`ranksOn`), and
 * never accuracy, which nothing measures yet. This page is in production
 * today, whatever Community's switch says.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ ranks: false }))
vi.mock('@/lib/rankings/ranks-on', () => ({ ranksOn: () => h.ranks }))

import { GuestBanner } from './guest-banner'

const text = () =>
  renderToStaticMarkup(createElement(GuestBanner))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

beforeEach(() => {
  h.ranks = false
})

describe('the guest banner says only what’s switched on', () => {
  it('rankings off (launch): it talks about lists — no rankings, no big board', () => {
    const out = text()
    expect(out).toContain('Make your own lists')
    expect(out).toContain('Share them with friends.')
    expect(out).not.toMatch(/ranking|big board/i)
    expect(out).toContain('Sign up free')
  })

  it('rankings on: lists and rankings', () => {
    h.ranks = true
    expect(text()).toContain('Make your own lists and rankings')
    expect(text()).not.toMatch(/big board/i)
  })

  it('never claims accuracy — nothing measures it yet', () => {
    for (const ranks of [false, true]) {
      h.ranks = ranks
      expect(text()).not.toMatch(/accura/i)
    }
  })
})
