/**
 * My start/sit's Back (Chris, 2026-10-15, gap list #26/#27): back to where
 * you came from — normally Profile — and to Profile when nothing of the app
 * is behind. It no longer goes Home.
 */
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const goBack = vi.fn()
vi.mock('@/components/mobile/ui/back-nav', () => ({ useGoBack: () => goBack }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => '/app/start-or-sit',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('@/hooks/use-mobile-profile-start-sit', () => ({
  useMobileProfileStartSit: () => ({ data: [], isLoading: false, isError: false, refetch: () => {} }),
}))

import { MyStartSitScreen } from './my-start-sit-screen'

/** The first element in `node`'s tree whose props match. */
function find(node: ReactNode, match: (props: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, match)
      if (hit) return hit
    }
    return null
  }
  if (!isValidElement(node)) return null
  const props = node.props as Record<string, unknown>
  if (match(props)) return props
  return find(props.children as ReactNode, match)
}

describe('My start/sit — Back', () => {
  it('goes back to where you came from, falling back to Profile', () => {
    let tree: ReactNode = null
    function Probe() {
      tree = MyStartSitScreen()
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    const back = find(tree, (props) => props['aria-label'] === 'Back')
    expect(back).not.toBeNull()
    ;(back!.onClick as () => void)()
    expect(goBack).toHaveBeenCalledWith('/app/profile')
  })

  it('is labelled plain "Back" (it no longer goes Home)', () => {
    const out = renderToStaticMarkup(createElement(MyStartSitScreen))
    expect(out).toContain('aria-label="Back"')
    expect(out).not.toContain('Back to Home')
  })
})
