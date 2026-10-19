'use client'

import { useId, useRef, useState } from 'react'

import { MessagesAvatar } from '@/components/mobile/messages/messages-avatar'
import { settingsButtonClass } from '@/components/mobile/settings/settings-parts'
import { initials } from '@/components/mobile/shell/use-league-card'
import { M_TEXT_FIELD, MNotice } from '@/components/mobile/ui/m-form'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useLeagueProfile } from '@/hooks/use-league'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/** The league name's limit (`PATCH /api/leagues/[id]/profile`, as desktop's
 *  rename field). */
export const LEAGUE_NAME_MAX = 100

/** Whether Save is on, and why not: a changed name of 1–100 characters
 *  (trimmed). An untouched name is never an error. */
export function leagueNameGate(draft: string, current: string): { ok: true; name: string } | { ok: false; why: string | null } {
  const name = draft.trim()
  if (name === current) return { ok: false, why: null }
  if (name.length === 0) return { ok: false, why: 'Give the league a name.' }
  if (name.length > LEAGUE_NAME_MAX) return { ok: false, why: `Keep it to ${LEAGUE_NAME_MAX} characters.` }
  return { ok: true, name }
}

/**
 * The league's name and photo — the commissioner's door from League
 * settings' "League name" row (desktop's league profile card, which a
 * commissioner can change in any season status). The same reads and writes
 * as desktop (`useLeagueProfile`: rename, upload, remove), in a phone
 * sheet: the 96px league tile (its photo, else its letters on its fill)
 * over the photo pills — the handoff's G1 avatar block — then the name in
 * the phone's text field and the 48px Save. Not optimistic: the name and
 * photo shown after a save are the server's, re-read.
 */
export function LeagueProfileSheet({
  open,
  onOpenChange,
  leagueId,
  name,
  avatarUrl,
  tileClass,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leagueId: string
  name: string
  avatarUrl: string | null
  /** The league tile's fill (`leagueAvClass`, the app's league order). */
  tileClass: string
}) {
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="League name and photo" showClose>
      {/* Remounts per open, so the field starts from the league's name. */}
      {open && <ProfileForm leagueId={leagueId} name={name} avatarUrl={avatarUrl} tileClass={tileClass} onDone={() => onOpenChange(false)} />}
    </MobileSheet>
  )
}

function ProfileForm({
  leagueId,
  name,
  avatarUrl,
  tileClass,
  onDone,
}: {
  leagueId: string
  name: string
  avatarUrl: string | null
  tileClass: string
  onDone: () => void
}) {
  const id = useId()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const { rename, uploadAvatar, removeAvatar } = useLeagueProfile(leagueId)
  const [draft, setDraft] = useState(name)
  const gate = leagueNameGate(draft, name)
  const pill = 'flex h-8 items-center rounded-pill px-3.5 text-[13px] font-semibold disabled:opacity-50'

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      await uploadAvatar.mutateAsync(file)
      toast({ title: 'League photo updated' })
    } catch (cause) {
      toast({ title: 'Couldn’t upload the photo', description: cause instanceof Error ? cause.message : 'Please try again.' })
    }
  }

  async function onRemove() {
    if (removeAvatar.isPending) return
    try {
      await removeAvatar.mutateAsync()
      toast({ title: 'Photo removed — showing the league’s letters' })
    } catch (cause) {
      toast({ title: 'Couldn’t remove the photo', description: cause instanceof Error ? cause.message : 'Please try again.' })
    }
  }

  return (
    <form
      className="flex flex-col gap-6 px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!gate.ok || rename.isPending) return
        rename.mutate(gate.name, {
          onSuccess: () => {
            toast({ title: 'League renamed', description: `Now playing as “${gate.name}”.` })
            onDone()
          },
        })
      }}
      data-league-profile-form
    >
      <div className="flex flex-col items-center gap-3">
        <MessagesAvatar
          text={initials(draft.trim() || name)}
          src={avatarUrl}
          sizeClass="size-24"
          radiusClass="rounded-[24px]"
          colorClass={tileClass}
          fgClass="text-inherit"
          textClass="text-[34px]"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploadAvatar.isPending}
            className={cn(pill, 'bg-m-gb text-m-tb active:bg-m-gb2')}
            data-league-photo-pick
          >
            {uploadAvatar.isPending ? 'Uploading…' : avatarUrl ? 'Change photo' : 'Upload photo'}
          </button>
          {avatarUrl && (
            <button type="button" onClick={() => void onRemove()} disabled={removeAvatar.isPending} className={cn(pill, 'bg-m-b2 text-m-t1 active:bg-m-b2h')}>
              {removeAvatar.isPending ? 'Removing…' : 'Remove'}
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void onFile(e)} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-name`} className="text-[13px] font-semibold text-m-t3">
          League name
        </label>
        <input
          id={`${id}-name`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={LEAGUE_NAME_MAX}
          autoComplete="off"
          enterKeyHint="done"
          className={M_TEXT_FIELD}
        />
        {!gate.ok && gate.why && <span className="text-[12px] font-medium text-m-t3">{gate.why}</span>}
      </div>
      {rename.error && <MNotice tone="error">{rename.error.message || 'Couldn’t rename the league. Please try again.'}</MNotice>}
      <button type="submit" disabled={!gate.ok || rename.isPending} className={settingsButtonClass('primary', gate.ok && !rename.isPending)} data-league-name-save>
        {rename.isPending ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
