'use client'

import { useEffect, useState } from 'react'

import { createBrowserClient } from '@/lib/supabase/client'
import { isDevAuthEnabled } from '@/lib/supabase/dev-auth'

export function DevAuthBadge() {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!isDevAuthEnabled()) return
    const supabase = createBrowserClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null)
    })
    return () => subscription.subscription.unsubscribe()
  }, [])

  if (!isDevAuthEnabled()) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 select-none rounded-full border border-destructive bg-destructive px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-destructive-foreground shadow-lg dark:shadow-black/40"
    >
      DEV AUTH — {email ?? 'signing in…'}
    </div>
  )
}
