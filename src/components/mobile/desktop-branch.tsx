'use client'

import { Suspense, use } from 'react'

/**
 * A page's desktop tree, kept INERT on a phone (used by `ByLayout`).
 *
 * The server can't know the layout, so `ByLayout` renders the desktop tree
 * during the hydration pass and only swaps to the mobile tree after it.
 * Mounting it there is not harmless: its queries subscribe and fire, and
 * some desktop GETs CREATE data server-side — the week's board
 * (`/api/big-board/week/[n]`) and the season board's seed / top-up
 * (`/api/lists/big-board`). A phone that merely opened Rankings would get a
 * week board it never asked for.
 *
 * So on a phone this holds the desktop subtree in a suspended Suspense
 * boundary: React keeps the server HTML (already hidden by `mob:hidden`)
 * without mounting it — no effects, no queries — until `ByLayout` replaces
 * it with the mobile tree. On desktop, and on the server, nothing suspends:
 * the desktop tree renders and hydrates exactly as before.
 */

let held: Promise<void> | null = null

/** Settles when the layout leaves mobile (so a forced-mobile window that
 *  widens back still gets its desktop tree). One shared promise: `use()`
 *  needs the same thenable on every attempt. */
function mobileHold(): Promise<void> {
  if (!held) {
    held = new Promise<void>((resolve) => {
      const html = document.documentElement
      const observer = new MutationObserver(() => {
        if (html.getAttribute('data-layout') !== 'mobile') {
          observer.disconnect()
          held = null
          resolve()
        }
      })
      observer.observe(html, { attributes: true, attributeFilter: ['data-layout'] })
    })
  }
  return held
}

function HoldOnMobile({ children }: { children: React.ReactNode }) {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-layout') === 'mobile') {
    use(mobileHold())
  }
  return <>{children}</>
}

export function DesktopBranch({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <HoldOnMobile>{children}</HoldOnMobile>
    </Suspense>
  )
}
