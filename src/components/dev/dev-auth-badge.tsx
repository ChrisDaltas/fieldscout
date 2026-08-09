'use client'

import { useEffect, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { createBrowserClient } from '@/lib/supabase/client'
import { isDevAuthEnabled } from '@/lib/supabase/dev-auth'

/** Dismissal is per-tab-session on purpose: the badge exists so you can't
 *  mistake the auto-signed-in dev user for a real one, so it comes back on a
 *  fresh tab rather than staying gone for good. */
const DISMISSED_KEY = 'fs.devAuthBadge.dismissed'

export function DevAuthBadge() {
  const [email, setEmail] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!isDevAuthEnabled()) return

    if (sessionStorage.getItem(DISMISSED_KEY) === '1') setDismissed(true)

    const supabase = createBrowserClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null)
    })
    return () => subscription.subscription.unsubscribe()
  }, [])

  if (!isDevAuthEnabled() || dismissed) return null

  const dismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, '1')
    setDismissed(true)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      // bottom-20 clears the 64px mobile tab bar; back to bottom-4 at lg,
      // where the tab bar is hidden.
      className="fixed bottom-20 right-4 z-50 flex select-none items-center gap-2 rounded-sm border border-ink bg-negative py-1.5 pl-3 pr-1.5 text-xs font-bold text-ink shadow-hard-4 lg:bottom-4"
    >
      <span>Dev auth — {email ?? 'signing in…'}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss dev auth badge"
        title="Hide until the next tab session"
        className="-my-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm transition-colors duration-200 ease-linear hover:bg-ink/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
      >
        <Icon name="close" size={11} />
      </button>
    </div>
  )
}
