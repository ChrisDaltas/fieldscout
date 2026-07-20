'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createBrowserClient } from '@/lib/supabase/client'

// Username contract (spec-redraft-leagues v2.8/v2.8.1, Q4 ruling): 5–20 chars,
// letters/numbers/underscores, permanent after selection. Mirrors migration
// 040's profiles_username_format_check (human pattern; case folded at save).
const USERNAME_REGEX = /^[a-zA-Z0-9_]{5,20}$/

// Pre-selection placeholder shape assigned by handle_new_user at signup.
// Reserved (R32, migration 050): selecting a placeholder-shaped name would
// leave the account "pre-selection" forever — this page's gate and filtered
// UPDATE both key on the shape — so it can never be explicitly chosen.
const PLACEHOLDER_REGEX = /^user_[0-9a-f]{8}$/

function validateUsername(value: string): string | null {
  if (value.length < 5) return 'Must be at least 5 characters'
  if (value.length > 20) return 'Must be 20 characters or fewer'
  if (!/^[a-zA-Z0-9_]+$/.test(value)) return 'Only letters, numbers, and underscores'
  if (PLACEHOLDER_REGEX.test(value.toLowerCase())) return 'This username format is reserved'
  return null
}

export default function UsernamePage() {
  const router = useRouter()
  const supabase = createBrowserClient()

  const [username, setUsername] = useState('')

  // Q7.2 (spec v2.8.1): usernames are permanent after explicit selection —
  // this page is the ONE sanctioned selection write. Users who already
  // selected get routed out; only placeholder holders may use it.
  useEffect(() => {
    let cancelled = false
    const gate = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .maybeSingle()
      if (!cancelled && profile && !PLACEHOLDER_REGEX.test(profile.username)) {
        router.replace('/app')
      }
    }
    gate()
    return () => {
      cancelled = true
    }
  }, [supabase, router])
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkAvailability = useCallback(
    async (value: string) => {
      if (!USERNAME_REGEX.test(value)) {
        setIsAvailable(null)
        return
      }

      setIsChecking(true)
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', value.toLowerCase())
        .maybeSingle()

      setIsAvailable(!data)
      setIsChecking(false)
    },
    [supabase]
  )

  // Debounced availability check (400ms)
  useEffect(() => {
    const err = validateUsername(username)
    setValidationError(username.length > 0 ? err : null)
    setIsAvailable(null)

    if (err || username.length === 0) return

    const timer = setTimeout(() => {
      checkAvailability(username)
    }, 400)

    return () => clearTimeout(timer)
  }, [username, checkAvailability])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (validationError || !isAvailable) return

    setIsSubmitting(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('You must be signed in')
      setIsSubmitting(false)
      return
    }

    // Belt for the mount gate: the write itself only applies while the row
    // still holds the pre-selection placeholder (Q7.2 — one selection write).
    const { data: updated, error: updateError } = await supabase
      .from('profiles')
      .update({
        username: username.toLowerCase(),
        display_name: username,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .filter('username', 'match', '^user_[0-9a-f]{8}$')
      .select('id')

    if (!updateError && (updated?.length ?? 0) === 0) {
      // Username was already selected (e.g. in another tab) — nothing written.
      router.replace('/app')
      return
    }

    if (updateError) {
      setError(
        updateError.code === '23505'
          ? 'Username is already taken'
          : updateError.message
      )
      setIsSubmitting(false)
      return
    }

    router.push('/app')
    router.refresh()
  }

  const showStatus = username.length > 0 && !validationError
  const statusIcon = isChecking ? (
    <Icon name="dots" size={13} className="text-n-3" />
  ) : isAvailable === true ? (
    <Icon name="check" size={13} className="text-positive-strong" />
  ) : isAvailable === false ? (
    <Icon name="close" size={13} className="text-negative-strong" />
  ) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose your username</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <p className="text-[12px] font-medium text-n-3">
            This is how other scouts will find you
          </p>
          {error && (
            <div className="flex items-center gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-bold text-ink">
              <Icon name="info-circle" size={13} className="shrink-0" />
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
            <div className="relative">
              <Input
                id="username"
                type="text"
                placeholder="your_username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={5}
                maxLength={20}
                autoComplete="username"
                autoFocus
                className="pr-10"
              />
              {showStatus && (
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                  {statusIcon}
                </div>
              )}
            </div>
            {validationError && (
              <p className="text-[11px] font-bold text-negative-strong">
                {validationError}
              </p>
            )}
            {!validationError && isAvailable === false && (
              <p className="text-[11px] font-bold text-negative-strong">
                Username is taken
              </p>
            )}
            {!validationError && isAvailable === true && (
              <p className="text-[11px] font-bold text-positive-strong">
                Username is available
              </p>
            )}
            <p className="text-[11px] font-medium text-n-3">
              5–20 characters. Letters, numbers, and underscores. Usernames are permanent.
            </p>
          </div>
          <div className="pt-1">
            <Button
              variant="blue"
              type="submit"
              className="w-full"
              disabled={isSubmitting || !isAvailable || !!validationError}
            >
              {isSubmitting ? 'Claiming…' : 'Continue'}
            </Button>
          </div>
        </CardContent>
      </form>
    </Card>
  )
}
