'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { AuthError, AuthField, AuthModal, AuthSubmit } from '@/components/landing/auth-modal'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Set-new-password modal over the landing page (`/reset-password`). Reached
 * only from the emailed reset link, which signs the person in first, so it
 * is always a direct load (middleware lets signed-in users through here).
 */
export function ResetPasswordModal() {
  const router = useRouter()
  const supabase = createBrowserClient()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
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

    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setIsLoading(false)
      return
    }

    router.push('/app')
    router.refresh()
  }

  return (
    <AuthModal route="/reset-password" title="Set new password" description="Enter your new password below.">
      <form onSubmit={handleSubmit} className="flex flex-col">
        <AuthError message={error} />
        <AuthField
          first
          id="password"
          label="New password"
          type="password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          autoFocus
        />
        <AuthField
          id="confirm-password"
          label="Confirm new password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <AuthSubmit busy={isLoading} label="Update password" busyLabel="Updating…" />
      </form>
    </AuthModal>
  )
}
