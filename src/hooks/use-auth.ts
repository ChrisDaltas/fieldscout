'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'

import { createBrowserClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import type { Profile } from '@/types/database'

// The session and profile are backed by React Query with fixed keys, so all
// ~13 useAuth() consumers on a page share ONE session fetch and ONE profile
// fetch (React Query dedupes concurrent observers of the same key) instead of
// each firing its own. This is what stopped the profile/My-stats page from
// stalling on skeletons under a storm of duplicate requests.
//
// The Zustand auth store stays the source of truth for `profile` (the fetch
// writes into it) so the existing store consumers — settings, avatar upload,
// AI modal — and their optimistic `updateProfile` calls keep working.

export const AUTH_SESSION_KEY = ['auth', 'session'] as const
export const authProfileKey = (userId: string | undefined) =>
  ['auth', 'profile', userId ?? 'anon'] as const

export function useAuth() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const qc = useQueryClient()
  const profile = useAuthStore((s) => s.profile)
  const setProfile = useAuthStore((s) => s.setProfile)

  // One deduped session query for the whole app. Updates arrive through
  // onAuthStateChange (below), so it never needs to refetch on its own.
  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: AUTH_SESSION_KEY,
    queryFn: async (): Promise<Session | null> => {
      const { data } = await supabase.auth.getSession()
      return data.session
    },
    staleTime: Infinity,
  })

  const user = session?.user ?? null

  // One deduped profile query, keyed by user id. Shared across every consumer.
  const { data: fetchedProfile, isLoading: profileFetching } = useQuery({
    queryKey: authProfileKey(user?.id),
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user!.id)
        .maybeSingle()
      if (error) throw error
      return (data as Profile | null) ?? null
    },
  })

  // Mirror the fetched profile into the store (source of truth for the
  // store-based consumers). undefined = query not resolved yet — leave the
  // store untouched so we don't flash a null over an optimistic update.
  useEffect(() => {
    if (fetchedProfile !== undefined) setProfile(fetchedProfile)
  }, [fetchedProfile, setProfile])

  useEffect(() => {
    if (!user) setProfile(null)
  }, [user, setProfile])

  // Keep the shared session cache in sync with auth events. Each consumer
  // registers a listener, but the callback only writes the shared cache
  // (idempotent) and invalidates the profile key — React Query collapses any
  // resulting refetch into one, so there is no fetch storm.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      qc.setQueryData(AUTH_SESSION_KEY, newSession)
      if (newSession?.user) {
        qc.invalidateQueries({ queryKey: ['auth', 'profile'] })
      }
    })
    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
    qc.setQueryData(AUTH_SESSION_KEY, null)
    router.push('/login')
  }

  // Loading only while the session is resolving, or while a signed-in user's
  // profile is still on its first fetch. Logged-out users resolve instantly.
  const isLoading = sessionLoading || (Boolean(user) && profileFetching)

  return {
    user,
    session: session ?? null,
    profile,
    isLoading,
    signOut,
  }
}
