'use client'

import { useState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createBrowserClient } from '@/lib/supabase/client'

export default function SignupPage() {
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
      <Card>
        <CardHeader className="min-h-0 border-0 px-[19px] pb-0 pt-[19px]">
          <CardTitle className="text-[24px] font-bold tracking-[-0.03em]">Check your email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3.5 px-[19px] pb-[19px] pt-2">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-deep">
              <Icon name="email" size={15} />
            </span>
            <p className="text-[11px] font-medium leading-[1.5] text-n-3">
              We sent a confirmation link to{' '}
              <strong className="text-ink">{email}</strong>. Click the link to
              verify your account and get started.
            </p>
          </div>
          <p className="text-center text-[11px] font-medium text-n-6">
            Didn&apos;t receive the email?{' '}
            <button
              type="button"
              onClick={() => setEmailSent(false)}
              className="font-semibold text-accent hover:underline"
            >
              Try again
            </button>
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="min-h-0 border-0 px-[19px] pb-0 pt-[19px]">
        <CardTitle className="text-[24px] font-bold tracking-[-0.03em]">Create your account</CardTitle>
      </CardHeader>
      <form onSubmit={handleSignup}>
        <CardContent className="space-y-3.5 px-[19px] pb-[19px] pt-2">
          <p className="text-[11px] font-medium text-n-3">
            Start ranking players in seconds
          </p>
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-negative-soft px-2.5 py-2 text-[11px] font-semibold text-negative-strong">
              <Icon name="info-circle" size={13} className="shrink-0" />
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div className="flex flex-col gap-3.5 pt-1">
            <Button variant="blue" type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Creating account…' : 'Create account'}
            </Button>
            <p className="text-center text-[11px] font-medium text-n-6">
              Already have an account?{' '}
              <Link href="/login" className="font-semibold text-accent hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </CardContent>
      </form>
    </Card>
  )
}
