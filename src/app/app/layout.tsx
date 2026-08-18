import { redirect } from 'next/navigation'

import { PLACEHOLDER_USERNAME_REGEX } from '@/lib/auth/username-contract'
import { createServerClient } from '@/lib/supabase/server'

/**
 * The signed-in gate for EVERY `/app` route — and nothing else.
 *
 * DR.1 / D147: the draft room is a full-screen, chrome-free surface
 * (spec §16.1 v2.12), so `<AppShell>` moved down into the `(shell)` route
 * group and the room lives in the sibling `(room)` group. Route groups do
 * not affect URLs, so `/app/leagues/[id]/draft` is byte-identical to what
 * shipped — no redirect, no link rewrite, no broken deep link.
 *
 * The guards deliberately did NOT move with the shell, and are deliberately
 * NOT duplicated into the two group layouts: ONE copy above both groups is
 * what keeps a cold load into the chrome-free room gated by the same code
 * path as every ordinary app route. A second copy is a second thing to
 * forget. `src/lib/route-groups.test.ts` pins that shape.
 */
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
  // from. Gating every route in — however you authenticated and however many
  // times you abandon the step — leads back to choosing one.
  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .single()

  if (!profile || PLACEHOLDER_USERNAME_REGEX.test(profile.username)) {
    redirect('/username')
  }

  return <>{children}</>
}
