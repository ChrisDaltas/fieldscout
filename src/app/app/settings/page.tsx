'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { PageHeader } from '@/components/layout/app-header'
import { EditableUserAvatar } from '@/components/profile/editable-user-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { createBrowserClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import type { Profile } from '@/types/database'

/**
 * Account settings — the model for "outside the nav" pages: no nav item is
 * active and the content leads with a Back stroke button. Two columns of
 * cards: Profile + Sign in & security on the left, Notifications + Sessions
 * on the right.
 */
export default function SettingsPage() {
  const router = useRouter()
  const { user, profile, isLoading, signOut } = useAuth()

  return (
    <div className="max-w-[784px]">
      <PageHeader title="Account settings" />

      <div className="mb-4">
        <Button variant="stroke" size="sm" onClick={() => router.back()}>
          <Icon name="arrow-prev" size={13} />
          Back
        </Button>
      </div>

      {isLoading || !profile ? (
        <SettingsSkeleton />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col gap-5">
            <ProfileCard profile={profile} />
            <SecurityCard email={user?.email ?? ''} />
          </div>
          <div className="flex flex-col gap-5">
            <NotificationsCard />
            <SessionsCard email={user?.email ?? ''} onSignOut={signOut} />
          </div>
        </div>
      )}
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1.1fr_1fr]">
      <div className="flex flex-col gap-5">
        <Skeleton className="h-72" />
        <Skeleton className="h-56" />
      </div>
      <div className="flex flex-col gap-5">
        <Skeleton className="h-80" />
        <Skeleton className="h-40" />
      </div>
    </div>
  )
}

/* ------------------------------- Profile ------------------------------- */

function validateUsername(value: string): string | null {
  if (value.length < 3) return 'Username must be at least 3 characters'
  if (value.length > 30) return 'Username must be 30 characters or fewer'
  if (!/^[a-zA-Z]/.test(value)) return 'Username must start with a letter'
  if (!/^[a-zA-Z0-9_]+$/.test(value))
    return 'Only letters, numbers, and underscores'
  return null
}

function ProfileCard({ profile }: { profile: Profile }) {
  const supabase = createBrowserClient()
  const setProfile = useAuthStore((s) => s.setProfile)
  const { toast } = useToast()

  const [displayName, setDisplayName] = useState(profile.display_name ?? '')
  const [username, setUsername] = useState(profile.username)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Re-seed the form if the profile identity changes under us (avatar saves
  // replace the store profile — don't clobber in-progress edits for those).
  useEffect(() => {
    setDisplayName(profile.display_name ?? '')
    setUsername(profile.username)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const nextUsername = username.trim().replace(/^@/, '')
    const usernameError = validateUsername(nextUsername)
    if (usernameError) {
      setError(usernameError)
      return
    }

    setIsSaving(true)
    const { data, error: updateError } = await supabase
      .from('profiles')
      .update({
        display_name: displayName.trim() || null,
        username: nextUsername.toLowerCase(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile.id)
      .select()
      .single()

    if (updateError) {
      setError(
        updateError.code === '23505'
          ? 'That username is already taken'
          : updateError.message,
      )
      setIsSaving(false)
      return
    }

    setProfile(data as Profile)
    setIsSaving(false)
    toast({ title: 'Profile saved' })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave}>
          <div className="border-b border-n-4 pb-4">
            <EditableUserAvatar
              src={profile.avatar_url}
              name={profile.display_name ?? profile.username}
            />
          </div>

          {error && <ErrorChip className="mt-4">{error}</ErrorChip>}

          <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="settings-display-name">Display name</Label>
              <Input
                id="settings-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={50}
                autoComplete="name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settings-username">Username</Label>
              <Input
                id="settings-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={30}
                autoComplete="username"
              />
              <p className="text-[11px] font-medium text-n-3">
                Shown with your rankings and posts.
              </p>
            </div>
          </div>

          <div className="mt-4">
            <Button variant="blue" size="sm" type="submit" disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

/* -------------------------- Sign in & security -------------------------- */

function SecurityCard({ email }: { email: string }) {
  const supabase = createBrowserClient()
  const { toast } = useToast()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const handleUpdatePassword = async (e: React.FormEvent) => {
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

    setIsSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setIsSaving(false)
      return
    }

    setPassword('')
    setConfirmPassword('')
    setIsSaving(false)
    toast({ title: 'Password updated' })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in &amp; security</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          <Label htmlFor="settings-email">Email</Label>
          <Input id="settings-email" type="email" value={email} disabled />
          <p className="text-[11px] font-medium text-n-3">
            Used to sign in and recover your account — never shown to other
            scouts.
          </p>
        </div>

        <form onSubmit={handleUpdatePassword} className="mt-4">
          {error && <ErrorChip className="mb-3.5">{error}</ErrorChip>}
          <div className="grid gap-3.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="settings-new-password">New password</Label>
              <Input
                id="settings-new-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settings-confirm-password">
                Confirm new password
              </Label>
              <Input
                id="settings-confirm-password"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
          </div>
          <div className="mt-3">
            <Button variant="blue" size="sm" type="submit" disabled={isSaving}>
              {isSaving ? 'Updating…' : 'Update password'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

/* ----------------------------- Notifications ---------------------------- */

interface NotificationRow {
  key: string
  title: string
  description: string
  defaultOn: boolean
}

// TODO(notif-prefs): there is no notification-preferences backend yet — the
// only real notification type today is `list_updated` (lists you follow).
// These toggles are local-only mock state; persist them once a prefs table
// or profile column ships.
const NOTIFICATION_ROWS: NotificationRow[] = [
  {
    key: 'list_updates',
    title: 'List updates',
    description: 'When a list you follow gets reworked',
    defaultOn: true,
  },
  {
    key: 'trades',
    title: 'Trade offers',
    description: 'When a GM sends or updates a trade',
    defaultOn: true,
  },
  {
    key: 'waivers',
    title: 'Waiver results',
    description: 'Claims processed, players added or dropped',
    defaultOn: true,
  },
  {
    key: 'injuries',
    title: 'Injury news',
    description: 'Status changes for players on your rosters',
    defaultOn: true,
  },
  {
    key: 'draft',
    title: 'Draft reminders',
    description: "Start times, and when you're on the clock",
    defaultOn: true,
  },
  {
    key: 'ai',
    title: 'Scout AI insights',
    description: 'Weekly lineup recommendations',
    defaultOn: false,
  },
]

function NotificationsCard() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NOTIFICATION_ROWS.map((r) => [r.key, r.defaultOn])),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent className="py-1.5">
        {NOTIFICATION_ROWS.map((row, i) => (
          <div
            key={row.key}
            className={cnRow(i === NOTIFICATION_ROWS.length - 1)}
          >
            <div className="mr-auto min-w-0">
              <div className="text-[13px] font-bold leading-tight">
                {row.title}
              </div>
              <div className="mt-0.5 text-[12px] font-medium text-n-3">
                {row.description}
              </div>
            </div>
            <Switch
              checked={prefs[row.key]}
              onCheckedChange={(checked) =>
                setPrefs((s) => ({ ...s, [row.key]: checked }))
              }
              aria-label={row.title}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function cnRow(last: boolean): string {
  return last
    ? 'flex items-center gap-3 py-3'
    : 'flex items-center gap-3 border-b border-n-4 py-3'
}

/* ------------------------------- Sessions ------------------------------- */

function SessionsCard({
  email,
  onSignOut,
}: {
  email: string
  onSignOut: () => void
}) {
  // TODO(sessions): Supabase exposes no session-listing API here — show the
  // honest single row for the current device until one exists.
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 border-b border-n-4 pb-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-ink bg-n-4">
            <Icon name="desktop" size={14} />
          </span>
          <div className="mr-auto min-w-0">
            <div className="text-[13px] font-bold leading-tight">
              This device
            </div>
            <div className="mt-0.5 truncate text-[12px] font-medium text-n-3">
              Signed in as {email}
            </div>
          </div>
          <Badge variant="stroke-green">Active</Badge>
        </div>
        <div className="mt-3.5">
          <Button variant="stroke" size="sm" onClick={onSignOut}>
            <Icon name="transfer" size={13} />
            Sign out
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/* -------------------------------- Shared -------------------------------- */

function ErrorChip({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-bold text-ink ${className ?? ''}`}
    >
      <Icon name="info-circle" size={13} className="shrink-0" />
      {children}
    </div>
  )
}
