'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { useLayoutModeValue } from '@/hooks/use-layout-mode'

/**
 * The desktop branch of a route that exists only as a mobile screen: a
 * desktop visit (a shared link, or a forced-mobile window widened back)
 * goes to the desktop page that shows the same thing. `keepQuery` carries
 * the address's query along — the phone's Latest page at `?list=<id>` is a
 * list, which desktop Community opens too (plan C5).
 */
export function DesktopRedirect({ href, keepQuery = false }: { href: string; keepQuery?: boolean }) {
  const mode = useLayoutModeValue()
  const router = useRouter()
  useEffect(() => {
    if (mode === 'desktop') router.replace(keepQuery ? `${href}${window.location.search}` : href)
  }, [mode, router, href, keepQuery])
  return null
}
