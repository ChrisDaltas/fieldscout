'use client'

import { useEffect } from 'react'

import { createBrowserClient } from '@/lib/supabase/client'
import { devAutoLogin, isDevAuthEnabled } from '@/lib/supabase/dev-auth'

export function DevAuthProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!isDevAuthEnabled()) return
    const supabase = createBrowserClient()
    devAutoLogin(supabase).then(({ signedIn }) => {
      // Reload so the freshly-set auth cookie reaches the server-rendered
      // layouts and middleware on the same load.
      if (signedIn) window.location.reload()
    })
  }, [])

  return <>{children}</>
}
