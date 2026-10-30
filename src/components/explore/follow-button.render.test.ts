/**
 * Follow keeps keyboard focus while it saves (Community sweep XPR-3) — the
 * fix C5 made for Like. Chrome moves focus to the page when a focused button
 * turns disabled, so a keyboard user lost their place in a feed or Scouts to
 * follow on every Follow. The button is never disabled: a follow in flight
 * is held by a guard in its click, and it says it's busy (aria-busy) — on the
 * desktop button and the phone pill alike.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ pending: false }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'u-me' } }) }))
vi.mock('@/hooks/use-follows', () => ({
  useFollowingIds: () => ({ data: new Set<string>() }),
  useToggleFollow: () => ({ isPending: h.pending, mutate: () => {} }),
}))

import { FollowButton } from './follow-button'

const render = (look: 'desktop' | 'phone') => renderToStaticMarkup(createElement(FollowButton, { userId: 'u-devpro', look }))

beforeEach(() => {
  h.pending = false
})

describe('Follow while it saves', () => {
  it('both looks: busy, never disabled (a focused button that turns disabled loses focus)', () => {
    h.pending = true
    for (const look of ['desktop', 'phone'] as const) {
      const out = render(look)
      expect(out).toContain('aria-busy="true"')
      expect(out).not.toMatch(/\sdisabled(=""|\s|>)/)
      expect(out).toContain('>Follow<')
    }
  })

  it('at rest: no busy mark, not disabled', () => {
    for (const look of ['desktop', 'phone'] as const) {
      const out = render(look)
      expect(out).not.toContain('aria-busy')
      expect(out).not.toMatch(/\sdisabled(=""|\s|>)/)
    }
  })

  it('a second press while one is in flight is ignored by the click itself (source pin)', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/components/explore/follow-button.tsx'), 'utf8')
    const click = src.slice(src.indexOf('const onClick = '), src.indexOf("if (look === 'phone')"))
    // After the signed-out hand-off, before the toggle.
    expect(click).toMatch(/if \(!user\) \{[\s\S]*?\}\s*(\/\/[^\n]*\s*)*if \(toggle\.isPending\) return\s*(\/\/[^\n]*\s*)*toggle\.mutate\(/)
    expect(src).not.toMatch(/(?<![-\w])disabled=\{toggle\.isPending\}/)
    expect(src.match(/aria-busy=\{toggle\.isPending \|\| undefined\}/g)).toHaveLength(2)
  })
})
