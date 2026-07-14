'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createBrowserClient } from '@/lib/supabase/client'

const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{2,29}$/

function validateUsername(value: string): string | null {
  if (value.length < 3) return 'Must be at least 3 characters'
  if (value.length > 30) return 'Must be 30 characters or fewer'
  if (!/^[a-zA-Z]/.test(value)) return 'Must start with a letter'
  if (!/^[a-zA-Z0-9_]+$/.test(value)) return 'Only letters, numbers, and underscores'
  return null
}

export default function UsernamePage() {
  const router = useRouter()
  const supabase = createBrowserClient()

  const [username, setUsername] = useState('')
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

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        username: username.toLowerCase(),
        display_name: username,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

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
                minLength={3}
                maxLength={30}
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
              3-30 characters. Letters, numbers, and underscores. Must start with a letter.
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
