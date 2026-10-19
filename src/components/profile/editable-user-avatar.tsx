'use client'

import { useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { UserAvatar } from '@/components/ui/user-avatar'
import { AVATAR_ACCEPT, useAvatarEditor } from '@/hooks/use-avatar-editor'
import { cn } from '@/lib/utils'

interface EditableUserAvatarProps {
  src?: string | null
  name?: string | null
  className?: string
}

/**
 * Avatar editor row — round avatar (people are round) beside "Change photo"
 * and "Remove" controls, per the Account settings profile card. The upload
 * and remove themselves are `useAvatarEditor` (the phone's Settings screen
 * uses the same pair).
 */
export function EditableUserAvatar({
  src,
  name,
  className,
}: EditableUserAvatarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { uploading, removing, onFileChange, remove } = useAvatarEditor()

  const handlePick = () => {
    if (uploading) return
    inputRef.current?.click()
  }

  return (
    <div className={cn('flex items-center gap-3.5', className)}>
      <UserAvatar
        src={src}
        name={name}
        className="h-[52px] w-[52px] shrink-0"
        fallbackClassName="text-[17px] font-bold"
      />
      <div className="flex flex-wrap gap-[5px]">
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
          onClick={() => void remove()}
          disabled={removing || !src}
        >
          {removing ? 'Removing…' : 'Remove'}
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        className="hidden"
        onChange={onFileChange}
      />
    </div>
  )
}
