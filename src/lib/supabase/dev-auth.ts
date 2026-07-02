import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_DEV_AUTH_EMAIL = 'dev@fieldscout.local'
const DEV_AUTH_PASSWORD = 'dev-password-1234'

// Build-time guard: refuse to compile a production bundle with the dev bypass on.
if (process.env.NEXT_PUBLIC_DEV_AUTH === 'true' && process.env.NODE_ENV === 'production') {
  throw new Error(
    'NEXT_PUBLIC_DEV_AUTH must not be "true" in a production build. ' +
      'Set it to "false" or remove it before building.',
  )
}

export function isDevAuthEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEV_AUTH === 'true'
}

export function getDevAuthEmail(): string {
  return process.env.NEXT_PUBLIC_DEV_AUTH_EMAIL || DEFAULT_DEV_AUTH_EMAIL
}

export interface DevAutoLoginResult {
  signedIn: boolean
}

export async function devAutoLogin(supabase: SupabaseClient): Promise<DevAutoLoginResult> {
  if (!isDevAuthEnabled()) return { signedIn: false }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (session) return { signedIn: false }

  const { error } = await supabase.auth.signInWithPassword({
    email: getDevAuthEmail(),
    password: DEV_AUTH_PASSWORD,
  })

  if (error) {
    console.error('[dev-auth] sign-in failed:', error.message)
    return { signedIn: false }
  }

  return { signedIn: true }
}
