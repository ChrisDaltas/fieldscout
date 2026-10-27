'use client'

import { useState, type ChangeEvent } from 'react'

import { useToast } from '@/hooks/use-toast'
import { useAuthStore } from '@/stores/auth-store'

/** The photo types the avatar picker accepts (and the upload route takes). */
export const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

/**
 * Your profile photo's two actions — upload and remove — for the desktop
 * avatar editor (`EditableUserAvatar`) and the phone's Settings screen (gap
 * list §4 item 101). Uploads via POST /api/profile/avatar, removes via
 * DELETE; both return the updated profile, which is pushed into the auth
 * store so every mounted avatar re-renders without a reload. Each says how
 * it went in a toast.
 */
export function useAvatarEditor() {
  const { toast } = useToast()
  // The route answers the readable columns only (migration 210), so merge —
  // a replace would drop the admin flag the profile hook added.
  const updateProfile = useAuthStore((s) => s.updateProfile)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)

  const upload = async (file: File) => {
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
      updateProfile(body)
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

  const remove = async () => {
    if (removing) return
    setRemoving(true)
    try {
      const res = await fetch('/api/profile/avatar', { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error ?? `Remove failed (${res.status})`)
      }
      updateProfile(body)
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

  /** A file input's change: upload the picked file, then clear the input so
   *  picking the same file again still fires. */
  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void upload(file)
  }

  return { uploading, removing, onFileChange, remove }
}
