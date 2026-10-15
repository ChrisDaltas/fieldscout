'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { PageHeader } from '@/components/layout/app-header'
import { EditableUserAvatar } from '@/components/profile/editable-user-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { createBrowserClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { Profile } from '@/types/database'

/**
 * Account settings — the model for "outside the nav" pages: no nav item is
 * active and the content leads with a quiet Back button. v7 Account
 * settings: one 612px column of grouped sections — a 14px bold title over a
 * hairline-bordered group of label/field rows.
 */
export default function SettingsPage() {
  const router = useRouter()
  const { user, profile, isLoading, signOut } = useAuth()

  return (
    <div className="max-w-[612px] pb-[54px]">
      <PageHeader title="Account settings" />

      {/* Mobile layout: the shell's mobile header carries Back. */}
      <div className="mb-3 mob:hidden">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <Icon name="arrow-prev" size={13} />
          Back
        </Button>
      </div>

      {isLoading || !profile ? (
        <SettingsSkeleton />
      ) : (
        <div className="flex flex-col gap-6">
          <ProfileCard profile={profile} />
          <SecurityCard email={user?.email ?? ''} />
          <NotificationsCard />
          <ScoringCard />
          <SessionsCard email={user?.email ?? ''} onSignOut={signOut} />
        </div>
      )}
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-40 rounded-2xl bg-surface-control" />
      <Skeleton className="h-44 rounded-2xl bg-surface-control" />
      <Skeleton className="h-72 rounded-2xl bg-surface-control" />
    </div>
  )
}

/* ------------------------------- Profile ------------------------------- */

/**
 * Profile card — avatar + the handle, and nothing else.
 *
 * FieldScout stores no name for a person (Chris's ruling, 2026-08-05): an
 * account is an email, a password and a permanent username. There is no
 * display-name or full-name field to edit here, so the card has no form and
 * no save button — the avatar editor persists itself.
 */
function ProfileCard({ profile }: { profile: Profile }) {
  return (
    <SettingsSection title="Profile">
      <div className="px-3.5 py-3">
        <EditableUserAvatar src={profile.avatar_url} name={profile.username} />
      </div>

      <FieldRow
        label={<FieldLabel htmlFor="settings-username">Username</FieldLabel>}
        hint="Usernames are permanent. This is the only name FieldScout shows — on your lists, rankings, and comments."
      >
        <Input
          id="settings-username"
          value={`@${profile.username}`}
          readOnly
          aria-readonly="true"
        />
      </FieldRow>
    </SettingsSection>
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
    <SettingsSection title="Sign in & security">
      <FieldRow
        label={<FieldLabel htmlFor="settings-email">Email</FieldLabel>}
        hint="Used to sign in and recover your account — never shown to other scouts."
      >
        <Input id="settings-email" type="email" value={email} disabled />
      </FieldRow>

      <form
        onSubmit={handleUpdatePassword}
        className="border-t border-n-4"
      >
        <FieldRow
          label={
            <FieldLabel htmlFor="settings-new-password">New password</FieldLabel>
          }
        >
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
        </FieldRow>
        <FieldRow
          label={
            <FieldLabel htmlFor="settings-confirm-password">
              Confirm new password
            </FieldLabel>
          }
        >
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
        </FieldRow>
        <div className="flex flex-col gap-2.5 border-t border-n-4 px-3.5 py-2.5">
          {error && <ErrorChip>{error}</ErrorChip>}
          <div className="flex justify-end">
            <Button variant="blue" size="md" type="submit" disabled={isSaving}>
              {isSaving ? 'Updating…' : 'Update password'}
            </Button>
          </div>
        </div>
      </form>
    </SettingsSection>
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
    <SettingsSection title="Notifications">
      {NOTIFICATION_ROWS.map((row) => (
        <div key={row.key} className={ROW}>
          <RowText title={row.title} sub={row.description} />
          <Switch
            checked={prefs[row.key]}
            onCheckedChange={(checked) =>
              setPrefs((s) => ({ ...s, [row.key]: checked }))
            }
            aria-label={row.title}
          />
        </div>
      ))}
    </SettingsSection>
  )
}

/* -------------------------------- Scoring -------------------------------- */

// Entry point to the scoring builder — nothing else links to it yet; the
// league-scoped version arrives with the league build.
function ScoringCard() {
  return (
    <SettingsSection title="Scoring">
      <div className={ROW}>
        <p className="mr-auto min-w-0 text-[11px] font-medium text-n-3">
          Pick a scoring preset or build your own system — your projections
          and player values follow it.
        </p>
        <Button variant="stroke" size="sm" asChild>
          <Link href="/app/settings/scoring">Open scoring</Link>
        </Button>
      </div>
    </SettingsSection>
  )
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
    <SettingsSection
      title="Sessions"
      after={
        <div className="flex flex-wrap gap-[5px]">
          <Button variant="stroke" size="md" onClick={onSignOut}>
            <Icon name="transfer" size={13} />
            Sign out
          </Button>
        </div>
      }
    >
      <div className={ROW}>
        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-surface-control text-n-2">
          <Icon name="desktop" size={13} />
        </span>
        <RowText title="This device" sub={`Signed in as ${email}`} truncateSub />
        <Badge variant="stroke-green">Active</Badge>
      </div>
    </SettingsSection>
  )
}

/* -------------------------------- Shared -------------------------------- */

/** One row inside a section group — hairline between rows, none on top. */
const ROW =
  'flex min-h-[44px] items-center gap-3.5 border-t border-n-4 px-3.5 py-[7px] first:border-t-0'

/** v7 section: 14px bold title over a hairline-bordered group of rows. */
function SettingsSection({
  title,
  children,
  after,
}: {
  title: string
  children: React.ReactNode
  /** Free-standing controls under the group (e.g. Sign out). */
  after?: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-[9px]">
      <h2 className="text-[14px] font-bold tracking-[-0.015em] text-ink">
        {title}
      </h2>
      <div className="overflow-hidden rounded-2xl border border-n-4 bg-white">
        {children}
      </div>
      {after}
    </section>
  )
}

/** v7 label/field row: 102px 11px label beside the control, hint beneath. */
function FieldRow({
  label,
  hint,
  children,
}: {
  label: React.ReactNode
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-n-4 px-3.5 py-2.5 first:border-t-0 sm:flex-row sm:items-start sm:gap-3.5">
      <div className="sm:flex sm:h-input sm:w-[102px] sm:shrink-0 sm:items-center">
        {label}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {children}
        {hint && (
          <p className="text-[10px] font-medium text-n-6">{hint}</p>
        )}
      </div>
    </div>
  )
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <Label htmlFor={htmlFor} className="text-[11px] font-semibold leading-tight">
      {children}
    </Label>
  )
}

function RowText({
  title,
  sub,
  truncateSub = false,
}: {
  title: string
  sub: string
  truncateSub?: boolean
}) {
  return (
    <div className="mr-auto flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-[11px] font-semibold text-ink">{title}</span>
      <span
        className={cn(
          'text-[10px] font-medium text-n-6',
          truncateSub && 'truncate',
        )}
      >
        {sub}
      </span>
    </div>
  )
}

function ErrorChip({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md bg-negative-soft px-3 py-2 text-[11px] font-semibold text-negative-strong',
        className,
      )}
    >
      <Icon name="info-circle" size={13} className="shrink-0" />
      {children}
    </div>
  )
}
