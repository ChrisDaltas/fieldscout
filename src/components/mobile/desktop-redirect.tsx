'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { useLayoutModeValue } from '@/hooks/use-layout-mode'

/**
 * The desktop branch of a route that exists only as a mobile screen: a
 * desktop visit (a shared link, or a forced-mobile window widened back)
 * goes to the desktop page that shows the same thing.
 */
export function DesktopRedirect({ href }: { href: string }) {
  const mode = useLayoutModeValue()
  const router = useRouter()
  useEffect(() => {
    if (mode === 'desktop') router.replace(href)
  }, [mode, router, href])
  return null
}
