'use client'

import { useMutation } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Change the signed-in account's password (Supabase Auth `updateUser`) — the
 * Sign in & security section on desktop and on the phone (gap list §4 item
 * 101). The pair is checked before this runs (`passwordProblem` /
 * `passwordGate`); Supabase's own refusal comes back as the error message.
 */
export function useUpdatePassword() {
  return useMutation({
    mutationFn: async (password: string) => {
      const supabase = createBrowserClient()
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw new Error(error.message)
    },
  })
}
