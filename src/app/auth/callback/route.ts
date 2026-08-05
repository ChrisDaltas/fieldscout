import { isPlaceholderUsername } from '@/lib/auth/username-contract'
import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/app'

  if (code) {
    const supabase = await createServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Check if user has a username set
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', user.id)
          .single()

        // Not chosen yet -> selection. Anchored via the shared contract: a
        // startsWith('user_') check also matches a legitimately chosen name
        // like `user_bob` and would trap that account here forever.
        // This is a convenience redirect only — /app/layout.tsx enforces the
        // same rule, so a user who never reaches this callback (it bounces to
        // /login when there is no code to exchange, and they sign in with a
        // password instead) is still asked.
        if (isPlaceholderUsername(profile?.username)) {
          return NextResponse.redirect(`${origin}/username`)
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
