'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import {
  AuthError,
  AuthField,
  AuthFooter,
  AuthModal,
  AuthSubmit,
  AuthSwitchLink,
} from '@/components/landing/auth-modal'
import { createBrowserClient } from '@/lib/supabase/client'
import { safeRedirectPath } from '@/utils/safe-redirect-path'

/** Sign-in modal over the landing page (`/login`; see AuthModal). */
export function SignInModal() {
  return (
    <AuthModal route="/login" title="Welcome back" description="Sign in to your FieldScout account.">
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </AuthModal>
  )
}

function SignInForm() {
  const searchParams = useSearchParams()
  // Same-origin paths only (validated, normalized); anything else → /app.
  const redirect = safeRedirectPath(searchParams.get('redirect'))
  const supabase = createBrowserClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError(signInError.message)
      setIsLoading(false)
      return
    }

    // Hard navigation so the new auth cookie reaches the server-rendered
    // /app layout in the same request — router.push happens before the cookie
    // round-trips to the middleware and gets bounced back to /login.
    window.location.href = redirect
  }

  return (
    <form onSubmit={handleLogin} className="flex flex-col">
      <AuthError message={error} />
      <AuthField
        first
        id="email"
        label="Email"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
      />
      <AuthField
        id="password"
        label="Password"
        aside={
          <AuthSwitchLink href="/forgot-password" className="text-[13px]">
            Forgot password?
          </AuthSwitchLink>
        }
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="current-password"
      />
      <AuthSubmit busy={isLoading} label="Sign in" busyLabel="Signing in…" />
      <AuthFooter>
        Don&apos;t have an account? <AuthSwitchLink href="/signup">Create account</AuthSwitchLink>
      </AuthFooter>
    </form>
  )
}
