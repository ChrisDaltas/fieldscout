'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { ListThumbnail } from '@/components/lists/list-thumbnail'
import { Icon } from '@/components/ui/icon'
import { listsKeys, type ThumbnailPlayer } from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface EditableThumbnailProps {
  listId: string
  positionFilter: string | null | undefined
  isTeam?: boolean
  imageUrl: string | null | undefined
  players?: ThumbnailPlayer[] | null
  editable: boolean
  className?: string
}

export function EditableThumbnail({
  listId,
  positionFilter,
  isTeam = false,
  imageUrl,
  players,
  editable,
  className,
}: EditableThumbnailProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const qc = useQueryClient()
  const { toast } = useToast()
  const [uploading, setUploading] = useState(false)

  const handlePick = () => {
    if (!editable || uploading) return
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
      const res = await fetch(`/api/lists/${listId}/thumbnail`, {
        method: 'POST',
        body: form,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error ?? `Upload failed (${res.status})`)
      }
      qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
      qc.invalidateQueries({ queryKey: listsKeys.all })
      toast({ title: 'Thumbnail updated' })
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

  if (!editable) {
    return (
      <ListThumbnail
        positionFilter={positionFilter}
        isTeam={isTeam}
        imageUrl={imageUrl}
        players={players}
        size="xl"
        className={className}
      />
    )
  }

  return (
    <div className={cn('group relative inline-flex', className)}>
      <ListThumbnail
        positionFilter={positionFilter}
        isTeam={isTeam}
        imageUrl={imageUrl}
        players={players}
        size="xl"
      />
      <button
        type="button"
        onClick={handlePick}
        disabled={uploading}
        aria-label="Change thumbnail"
        className={cn(
          'absolute inset-0 flex items-center justify-center rounded-sm bg-ink/85 text-white opacity-0 transition-opacity group-hover:opacity-100',
          uploading && 'opacity-100',
        )}
      >
        {uploading ? (
          <span className="text-[11px] font-bold">Uploading…</span>
        ) : (
          <span className="flex flex-col items-center gap-1 text-[11px] font-bold">
            <Icon name="edit" size={14} />
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
