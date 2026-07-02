'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User, Session } from '@supabase/supabase-js'
import { createBrowserClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import type { Profile } from '@/types/database'

export function useAuth() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const { profile, setProfile } = useAuthStore()
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const fetchProfile = async (userId: string) => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle()
        if (cancelled) return
        if (error) {
          console.error('[useAuth] profile fetch error', error)
          return
        }
        setProfile((data as Profile | null) ?? null)
      } catch (err) {
        console.error('[useAuth] profile fetch threw', err)
      }
    }

    const getInitialSession = async () => {
      try {
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession()
        if (cancelled) return

        setSession(currentSession)
        setUser(currentSession?.user ?? null)

        if (currentSession?.user) {
          await fetchProfile(currentSession.user.id)
        }
      } catch (err) {
        // Don't let an auth/network error leave the UI stuck on a loading
        // spinner — log it and let downstream components render the
        // signed-out / no-profile states instead.
        console.error('[useAuth] getSession failed', err)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    getInitialSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (cancelled) return
      setSession(newSession)
      setUser(newSession?.user ?? null)

      if (newSession?.user) {
        await fetchProfile(newSession.user.id)
      } else {
        setProfile(null)
      }

      setIsLoading(false)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
    router.push('/login')
  }

  return {
    user,
    session,
    profile,
    isLoading,
    signOut,
  }
}
