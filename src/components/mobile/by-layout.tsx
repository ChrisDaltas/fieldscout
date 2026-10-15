'use client'

import { useLayoutModeValue } from '@/hooks/use-layout-mode'

/**
 * Renders a page's MOBILE tree in the mobile layout and its desktop tree
 * everywhere else (FieldScout Mobile handoff — mobile is its own design, not
 * a squeezed desktop).
 *
 * The server and the hydration pass don't know the mode, so they render the
 * desktop tree inside a `mob:hidden` wrapper: on a phone the head script has
 * already set `data-layout="mobile"`, so that tree is never visible there,
 * and the mobile tree replaces it as soon as the client resolves the mode.
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
  if (mode === 'mobile') return <>{mobile}</>
  return <div className="contents mob:hidden">{desktop}</div>
}
