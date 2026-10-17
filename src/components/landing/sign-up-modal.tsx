'use client'

import { useState } from 'react'

import {
  AuthError,
  AuthField,
  AuthFooter,
  AuthModal,
  AuthNotice,
  AuthSubmit,
  AuthSwitchLink,
} from '@/components/landing/auth-modal'
import { createBrowserClient } from '@/lib/supabase/client'

/** Create-account modal over the landing page (`/signup`; see AuthModal). */
export function SignUpModal() {
  const supabase = createBrowserClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setIsLoading(true)

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/username`,
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setIsLoading(false)
      return
    }

    setEmailSent(true)
    setIsLoading(false)
  }

  if (emailSent) {
    return (
      <AuthModal route="/signup" title="Check your email" description="One more step to finish signing up.">
        <AuthNotice>
          We sent a confirmation link to <strong className="text-fs-ink">{email}</strong>. Click the link to
          verify your account and get started.
        </AuthNotice>
        <AuthFooter>
          Didn&apos;t receive the email?{' '}
          <button
            type="button"
            onClick={() => setEmailSent(false)}
            className="font-semibold text-fs-blue hover:text-fs-blue-hover"
          >
            Try again
          </button>
        </AuthFooter>
      </AuthModal>
    )
  }

  return (
    <AuthModal route="/signup" title="Create your account" description="Start ranking players in seconds.">
      <form onSubmit={handleSignup} className="flex flex-col">
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
          type="password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <AuthField
          id="confirm-password"
          label="Confirm password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <AuthSubmit busy={isLoading} label="Create account" busyLabel="Creating account…" />
        <AuthFooter>
          Already have an account? <AuthSwitchLink href="/login">Sign in</AuthSwitchLink>
        </AuthFooter>
      </form>
    </AuthModal>
  )
}
