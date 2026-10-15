'use client'

import { DesktopBranch } from '@/components/mobile/desktop-branch'
import { useLayoutModeValue } from '@/hooks/use-layout-mode'

/**
 * Renders a page's MOBILE tree in the mobile layout and its desktop tree
 * everywhere else (FieldScout Mobile handoff — mobile is its own design, not
 * a squeezed desktop).
 *
 * The server and the hydration pass don't know the mode, so they render the
 * desktop tree inside a `mob:hidden` wrapper: on a phone the head script has
 * already set `data-layout="mobile"`, so that tree is never visible there —
 * nor mounted (`DesktopBranch` holds it, so its queries never fire) — and
 * the mobile tree replaces it as soon as the client resolves the mode.
 * Desktop users never see a swap.
 */
export function ByLayout({
  desktop,
  mobile,
}: {
  desktop: React.ReactNode
  mobile: React.ReactNode
}) {
  const mode = useLayoutModeValue()
  // `data-by-layout` marks a page that HAS a mobile screen (globals.css keeps
  // pages without one light in mobile dark mode).
  if (mode === 'mobile')
    return (
      <div className="contents" data-by-layout>
        {mobile}
      </div>
    )
  return (
    <div className="contents mob:hidden" data-by-layout>
      <DesktopBranch>{desktop}</DesktopBranch>
    </div>
  )
}
