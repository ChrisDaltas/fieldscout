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
import { Icon } from '@/components/ui/icon'
import { createBrowserClient } from '@/lib/supabase/client'

function BackToSignIn() {
  return (
    <AuthFooter>
      <AuthSwitchLink href="/login" className="inline-flex items-center gap-1">
        <Icon name="arrow-prev" size={12} />
        Back to sign in
      </AuthSwitchLink>
    </AuthFooter>
  )
}

/** Forgot-password modal over the landing page (`/forgot-password`; see AuthModal). */
export function ForgotPasswordModal() {
  const supabase = createBrowserClient()

  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })

    if (resetError) {
      setError(resetError.message)
      setIsLoading(false)
      return
    }

    setEmailSent(true)
    setIsLoading(false)
  }

  if (emailSent) {
    return (
      <AuthModal route="/forgot-password" title="Check your email" description="Your reset link is on its way.">
        <AuthNotice>
          We sent a password reset link to <strong className="text-fs-ink">{email}</strong>. Click the link to set
          a new password.
        </AuthNotice>
        <BackToSignIn />
      </AuthModal>
    )
  }

  return (
    <AuthModal
      route="/forgot-password"
      title="Reset your password"
      description="Enter your email and we'll send you a reset link."
    >
      <form onSubmit={handleSubmit} className="flex flex-col">
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
          autoFocus
        />
        <AuthSubmit busy={isLoading} label="Send reset link" busyLabel="Sending…" />
        <BackToSignIn />
      </form>
    </AuthModal>
  )
}
