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
      className="fixed bottom-4 right-4 z-50 select-none rounded-sm border border-ink bg-negative px-3 py-1.5 text-xs font-bold text-ink shadow-hard-4"
    >
      Dev auth — {email ?? 'signing in…'}
    </div>
  )
}
