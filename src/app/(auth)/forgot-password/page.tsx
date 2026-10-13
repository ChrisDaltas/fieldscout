'use client'

import { useState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createBrowserClient } from '@/lib/supabase/client'

export default function ForgotPasswordPage() {
  const supabase = createBrowserClient()

  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      }
    )

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
              We sent a password reset link to{' '}
              <strong className="text-ink">{email}</strong>. Click the link to
              set a new password.
            </p>
          </div>
          <Button variant="stroke" className="w-full" asChild>
            <Link href="/login">
              <Icon name="arrow-prev" size={13} />
              Back to sign in
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="min-h-0 border-0 px-[19px] pb-0 pt-[19px]">
        <CardTitle className="text-[24px] font-bold tracking-[-0.03em]">Reset your password</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-3.5 px-[19px] pb-[19px] pt-2">
          <p className="text-[11px] font-medium text-n-3">
            Enter your email and we&apos;ll send you a reset link
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
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-3.5 pt-1">
            <Button variant="blue" type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Sending…' : 'Send reset link'}
            </Button>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-1 text-center text-[11px] font-semibold text-accent hover:underline"
            >
              <Icon name="arrow-prev" size={12} />
              Back to sign in
            </Link>
          </div>
        </CardContent>
      </form>
    </Card>
  )
}
