'use client'

import Link from 'next/link'
import { useId, useRef, useState } from 'react'

import { FieldRow, SettingsSkin, ToggleRow } from '@/components/leagues/settings-form-controls'
import { CenteredNote } from '@/components/mobile/league/league/league-bits'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { M_TEXT_FIELD, MNotice } from '@/components/mobile/ui/m-form'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileScreen, MPageBar } from '@/components/mobile/ui/mobile-header'
import {
  EMAIL_HINT,
  NOTIFICATION_ROWS,
  USERNAME_HINT,
  defaultNotificationPrefs,
  passwordGate,
} from '@/components/settings/account-settings-ops'
import { UsernameLink } from '@/components/shared/username-link'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useAuth } from '@/hooks/use-auth'
import { AVATAR_ACCEPT, useAvatarEditor } from '@/hooks/use-avatar-editor'
import { useToast } from '@/hooks/use-toast'
import { useUpdatePassword } from '@/hooks/use-update-password'
import { cn } from '@/lib/utils'
import type { Profile } from '@/types/database'

import { SettingsField, SettingsGroup, SettingsSkeleton, settingsButtonClass } from './settings-parts'

/** Where Settings' Back goes when nothing in the app is behind it: Profile,
 *  whose gear opens it. */
export const SETTINGS_PARENT = '/app/profile'

/**
 * Account settings on the phone (gap list §4 item 101) — the same data and
 * actions as desktop's `/app/settings`, in the phone's own screen: a 52px
 * bar (blue back chevron, "Settings"), then
 *  - your photo, large and centred with Upload / Change photo and Remove
 *    under it (the handoff's G1 "My team" avatar block — the same upload and
 *    remove as desktop, `useAvatarEditor`);
 *  - Profile: your @handle (a door to your profile), permanent;
 *  - Sign in & security: the email, and a new password typed twice — Update
 *    stays off until the pair can be saved and says why as you type
 *    (prevent, don't refuse; `passwordGate`);
 *  - Notifications: the same six switches (local-only on both layouts until
 *    a preferences backend ships — gap list §2);
 *  - Scoring: the door to the scoring builder;
 *  - Sessions: this device, and Sign out.
 * The handoff draws no account Settings, so this extends its League
 * settings pages (`settings-parts.tsx`). Back goes to where you came from,
 * else Profile.
 */
export function MobileAccountSettings() {
  const goBack = useGoBack()
  const { user, profile, isLoading, signOut } = useAuth()
  const header = <MPageBar title="Settings" onBack={() => goBack(SETTINGS_PARENT)} />

  return (
    <MobileScreen header={header}>
      {isLoading ? (
        <SettingsSkeleton blocks={['avatar', 'row', 'row', 'card', 'card']} />
      ) : !profile ? (
        <CenteredNote role="alert" message="We couldn’t load your account. Refresh to try again." />
      ) : (
        <SettingsSkin layout="mobile">
          <div className="flex flex-col gap-[18px] px-4 pb-8 pt-6" data-account-settings>
            <PhotoBlock profile={profile} />
            <SettingsGroup title="Profile">
              <FieldRow label="Username" hint={USERNAME_HINT}>
                <UsernameLink username={profile.username} className="truncate text-[14px] font-semibold text-m-t1" />
              </FieldRow>
            </SettingsGroup>
            <SecurityGroup email={user?.email ?? ''} />
            <NotificationsGroup />
            <SettingsGroup title="Scoring">
              <Link
                href="/app/settings/scoring"
                className="flex min-h-[52px] items-center gap-3 py-2.5 active:opacity-60"
                data-settings-scoring-link
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[14px] font-semibold text-m-t1">Scoring system</span>
                  <span className="text-[12px] font-medium leading-[1.35] text-m-t3">
                    Pick a scoring preset or build your own — your projections and player values follow it.
                  </span>
                </span>
                <MIcon name="chevronRight" size={14} stroke={2} className="text-m-t3" />
              </Link>
            </SettingsGroup>
            <SessionsGroup email={user?.email ?? ''} onSignOut={signOut} />
          </div>
        </SettingsSkin>
      )}
    </MobileScreen>
  )
}

/* -------------------------------- Photo --------------------------------- */

/**
 * The avatar block (handoff G1): a 96px circle — your photo, or your two
 * letters on blue (ruling #8) — over the blue-tint photo pill, and Remove
 * beside it when there is a photo to remove.
 */
function PhotoBlock({ profile }: { profile: Profile }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { uploading, removing, onFileChange, remove } = useAvatarEditor()
  const hasPhoto = Boolean(profile.avatar_url)
  const pill = 'flex h-8 items-center rounded-pill px-3.5 text-[13px] font-semibold disabled:opacity-50'

  return (
    <div className="flex flex-col items-center gap-3" data-settings-photo>
      <UserAvatar
        src={profile.avatar_url}
        name={profile.username}
        className="size-24 flex-none bg-m-b2"
        fallbackClassName="bg-accent text-[36px] font-semibold text-white"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={cn(pill, 'bg-m-gb text-m-tb active:bg-m-gb2')}
          data-settings-photo-pick
        >
          {uploading ? 'Uploading…' : hasPhoto ? 'Change photo' : 'Upload photo'}
        </button>
        {hasPhoto && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={removing}
            className={cn(pill, 'bg-m-b2 text-m-t1 active:bg-m-b2h')}
            data-settings-photo-remove
          >
            {removing ? 'Removing…' : 'Remove'}
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept={AVATAR_ACCEPT} className="hidden" onChange={onFileChange} />
    </div>
  )
}

/* -------------------------- Sign in & security -------------------------- */

function SecurityGroup({ email }: { email: string }) {
  const id = useId()
  const { toast } = useToast()
  const update = useUpdatePassword()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const gate = passwordGate(password, confirm)
  const why = gate.ok ? null : gate.why
  const ready = gate.ok && !update.isPending
  // Any edit after a refusal clears it (the next press is a new try).
  const edit = (set: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    set(event.target.value)
    if (update.isError) update.reset()
  }

  return (
    <SettingsGroup title="Sign in & security">
      <FieldRow label="Email" hint={EMAIL_HINT}>
        <span className="max-w-full truncate text-[14px] font-semibold text-m-t1" data-settings-email>
          {email}
        </span>
      </FieldRow>
      <form
        className="flex flex-col"
        onSubmit={(event) => {
          event.preventDefault()
          if (!ready) return
          update.mutate(password, {
            onSuccess: () => {
              setPassword('')
              setConfirm('')
              toast({ title: 'Password updated' })
            },
          })
        }}
        data-settings-password
      >
        <SettingsField label="New password" htmlFor={`${id}-new`}>
          <input
            id={`${id}-new`}
            type="password"
            value={password}
            onChange={edit(setPassword)}
            autoComplete="new-password"
            disabled={update.isPending}
            className={M_TEXT_FIELD}
          />
        </SettingsField>
        <SettingsField label="Confirm new password" htmlFor={`${id}-confirm`}>
          <input
            id={`${id}-confirm`}
            type="password"
            value={confirm}
            onChange={edit(setConfirm)}
            autoComplete="new-password"
            enterKeyHint="done"
            disabled={update.isPending}
            aria-describedby={why ? `${id}-why` : undefined}
            className={M_TEXT_FIELD}
          />
        </SettingsField>
        <div className="flex flex-col gap-2.5 pt-1">
          {why && (
            <p id={`${id}-why`} className="text-[12px] font-medium text-m-t3" data-settings-password-why>
              {why}
            </p>
          )}
          {update.error && <MNotice tone="error">{update.error.message}</MNotice>}
          <button type="submit" disabled={!ready} className={settingsButtonClass('primary', gate.ok)} data-settings-password-save>
            {update.isPending ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </form>
    </SettingsGroup>
  )
}

/* ----------------------------- Notifications ---------------------------- */

function NotificationsGroup() {
  // Local-only until a preferences backend ships (TODO(notif-prefs) in
  // account-settings-ops.ts) — the same as desktop.
  const [prefs, setPrefs] = useState<Record<string, boolean>>(defaultNotificationPrefs)
  return (
    <SettingsGroup title="Notifications">
      <div className="flex flex-col">
        {NOTIFICATION_ROWS.map((row) => (
          <ToggleRow
            key={row.key}
            id={`m-notif-${row.key}`}
            label={row.title}
            hint={row.description}
            checked={prefs[row.key] ?? row.defaultOn}
            onCheckedChange={(checked) => setPrefs((s) => ({ ...s, [row.key]: checked }))}
          />
        ))}
      </div>
    </SettingsGroup>
  )
}

/* ------------------------------- Sessions ------------------------------- */

function SessionsGroup({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  // TODO(sessions): Supabase exposes no session-listing API here — the one
  // honest row for the current device, as on desktop.
  return (
    <SettingsGroup title="Sessions">
      <div className="flex min-h-[52px] items-center gap-3 py-2.5" data-settings-session>
        <span className="flex size-8 flex-none items-center justify-center rounded-[10px] bg-m-b2 text-m-t1">
          <MIcon name="device" size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[14px] font-semibold text-m-t1">This device</span>
          <span className="truncate text-[12px] font-medium text-m-t3">Signed in as {email}</span>
        </span>
        <span className="flex-none text-[12px] font-semibold text-m-green">Active</span>
      </div>
      <button type="button" onClick={onSignOut} className={cn(settingsButtonClass('quiet'), 'mt-2')} data-settings-sign-out>
        Sign out
      </button>
    </SettingsGroup>
  )
}
