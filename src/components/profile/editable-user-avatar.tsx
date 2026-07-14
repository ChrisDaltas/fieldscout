'use client'

import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useAuthStore } from '@/stores/auth-store'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface EditableUserAvatarProps {
  src?: string | null
  name?: string | null
  className?: string
}

/**
 * Avatar editor row — round avatar (people are round) beside "Change photo"
 * and "Remove" controls, per the Account settings profile card. Uploads via
 * POST /api/profile/avatar, removes via DELETE; both return the updated
 * profile, which is pushed into the auth store so every mounted UserAvatar
 * re-renders without a reload.
 */
export function EditableUserAvatar({
  src,
  name,
  className,
}: EditableUserAvatarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { toast } = useToast()
  const setProfile = useAuthStore((s) => s.setProfile)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)

  const handlePick = () => {
    if (uploading) return
    inputRef.current?.click()
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: form,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error ?? `Upload failed (${res.status})`)
      }
      setProfile(body)
      toast({ title: 'Profile photo updated' })
    } catch (err) {
      toast({
        title: 'Could not upload',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = async () => {
    if (removing) return
    setRemoving(true)
    try {
      const res = await fetch('/api/profile/avatar', { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error ?? `Remove failed (${res.status})`)
      }
      setProfile(body)
      toast({ title: 'Photo removed — showing initials' })
    } catch (err) {
      toast({
        title: 'Could not remove photo',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className={cn('flex items-center gap-4', className)}>
      {/* !rounded-pill: the base Avatar's rounded-sm survives twMerge (custom
          token), so force the people-are-round rule here. */}
      <UserAvatar
        src={src}
        name={name}
        className="h-16 w-16 shrink-0 !rounded-pill"
        fallbackClassName="text-[16px]"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="stroke"
          size="sm"
          type="button"
          onClick={handlePick}
          disabled={uploading}
        >
          <Icon name="repeat" size={13} />
          {uploading ? 'Uploading…' : 'Change photo'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={handleRemove}
          disabled={removing || !src}
        >
          {removing ? 'Removing…' : 'Remove'}
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  )
}
