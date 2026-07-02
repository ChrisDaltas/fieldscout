'use client'

import { Camera, Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'

import { UserAvatar } from '@/components/ui/user-avatar'
import { useAuthStore } from '@/stores/auth-store'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface EditableUserAvatarProps {
  src?: string | null
  name?: string | null
  className?: string
  /** Visual size of the avatar — Tailwind h/w classes applied via className. */
}

export function EditableUserAvatar({
  src,
  name,
  className,
}: EditableUserAvatarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { toast } = useToast()
  const setProfile = useAuthStore((s) => s.setProfile)
  const [uploading, setUploading] = useState(false)

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
      // Auth store holds the live profile — update it so every UserAvatar
      // mounted across the app re-renders without a page reload.
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

  return (
    <div className={cn('group relative inline-flex', className)}>
      <UserAvatar
        src={src}
        name={name}
        className="h-full w-full"
        fallbackClassName="text-base"
      />
      <button
        type="button"
        onClick={handlePick}
        disabled={uploading}
        aria-label="Change profile photo"
        className={cn(
          'absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-foreground opacity-0 transition-opacity group-hover:opacity-100',
          uploading && 'opacity-100',
        )}
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[11px] font-semibold">
            <Camera className="h-5 w-5" />
            Change
          </span>
        )}
      </button>
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
