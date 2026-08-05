import { redirect } from 'next/navigation'

import { AppShell } from '@/components/layout/app-shell'
import { PLACEHOLDER_USERNAME_REGEX } from '@/lib/auth/username-contract'
import { createServerClient } from '@/lib/supabase/server'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?redirect=/app')
  }

  // Username selection is enforced HERE, not only in the email-confirmation
  // callback, because that callback is the least reliable path in the app: if
  // exchangeCodeForSession finds no code it bounces to /login, the user signs
  // in with their password instead, and a normal login goes straight to /app —
  // so they are never asked. Observed in production 2026-08-05: an account
  // reached /app and kept its generated user_xxxxxxxx handle, which is
  // permanent and is what /u/{username}/lists/{slug} share links are built
  // from. Gating the app shell means every route in, however you authenticated
  // and however many times you abandon the step, leads back to choosing one.
  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .single()

  if (!profile || PLACEHOLDER_USERNAME_REGEX.test(profile.username)) {
    redirect('/username')
  }

  return <AppShell>{children}</AppShell>
}
