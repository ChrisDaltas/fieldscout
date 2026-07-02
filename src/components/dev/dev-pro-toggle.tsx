'use client'

import { useEffect, useState } from 'react'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * DEV ONLY: corner pill that flips the signed-in account between Free and
 * Pro (via /api/dev/toggle-pro). Compiled out of production bundles —
 * NODE_ENV is inlined at build time, so the prod tree-shakes this to null.
 */
export function DevProToggle() {
  const [isPro, setIsPro] = useState<boolean | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    const supabase = createBrowserClient()
    let cancelled = false

    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (cancelled) return
      setSignedIn(Boolean(user))
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('is_pro')
        .eq('id', user.id)
        .maybeSingle()
      if (!cancelled) setIsPro(Boolean(data?.is_pro))
    }
    load()

    const { data: subscription } = supabase.auth.onAuthStateChange(() => {
      load()
    })
    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  if (process.env.NODE_ENV === 'production' || !signedIn) return null

  const toggle = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/dev/toggle-pro', { method: 'POST' })
      if (!res.ok) return
      // Full reload: every cached profile read (auth store, react-query,
      // server components) picks up the new tier. Fine for a dev tool.
      window.location.reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy || isPro === null}
      title="Dev only: toggle this account between Free and Pro"
      className="fixed bottom-4 left-4 z-50 select-none rounded-full border border-bg-elevated-3 bg-bg-elevated px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary shadow-lg transition-colors hover:text-foreground disabled:opacity-60"
    >
      {isPro === null ? 'DEV — …' : isPro ? 'DEV — PRO ✦' : 'DEV — FREE'}
    </button>
  )
}
