'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import {
  foldersKeys,
  uploadFolderThumbnail,
  useCreateFolder,
  useUpdateFolder,
} from '@/hooks/use-folders'
import { useToast } from '@/hooks/use-toast'
import type { ListFolder } from '@/types/database'

interface FolderFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  folder?: ListFolder
}

/**
 * Create / edit a folder: name plus an optional custom thumbnail.
 * Without a custom image the folder shows the default folder icon.
 */
export function FolderFormDialog({
  open,
  onOpenChange,
  mode,
  folder,
}: FolderFormDialogProps) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const createFolder = useCreateFolder()
  const updateFolder = useUpdateFolder()

  const [name, setName] = useState(folder?.name ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      setName(folder?.name ?? '')
      setFile(null)
      setPreview(null)
    }
  }, [open, folder])

  // Object URL preview for a freshly chosen image.
  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const submitting = createFolder.isPending || updateFolder.isPending || uploading
  const canSubmit = name.trim().length > 0 && !submitting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    try {
      let target: ListFolder
      if (mode === 'create') {
        target = await createFolder.mutateAsync({ name: name.trim() })
      } else {
        if (!folder) return
        target =
          name.trim() !== folder.name
            ? await updateFolder.mutateAsync({ id: folder.id, name: name.trim() })
            : folder
      }

      if (file) {
        setUploading(true)
        try {
          await uploadFolderThumbnail(target.id, file)
          // Refresh the folders cache so the sidebar swaps the folder icon for
          // the new thumbnail immediately (create/update invalidated earlier,
          // before the upload set thumbnail_url).
          await qc.invalidateQueries({ queryKey: foldersKeys.all })
        } finally {
          setUploading(false)
        }
      }

      toast({
        title: mode === 'create' ? 'Folder created' : 'Folder updated',
        description: name.trim(),
      })
      onOpenChange(false)
    } catch (err) {
      toast({
        title:
          mode === 'create' ? 'Could not create folder' : 'Could not save folder',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    }
  }

  const thumbnailSrc = preview ?? folder?.thumbnail_url ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'Create a folder' : 'Edit folder'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Change folder thumbnail"
              className="group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-ink bg-white transition-colors hover:bg-n-4"
            >
              {thumbnailSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbnailSrc}
                  alt="Folder thumbnail"
                  className="h-full w-full object-cover"
                />
              ) : (
                <Icon name="folder" size={22} className="text-ink" />
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-ink/85 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <Icon name="edit" size={14} />
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink">Thumbnail</p>
              <p className="text-xs font-medium text-n-3">
                Optional — defaults to the folder icon.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[12px] font-bold text-ink">
              Folder name
            </label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="e.g. Draft prep"
              required
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="stroke"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="blue" shadow disabled={!canSubmit}>
              {submitting
                ? mode === 'create'
                  ? 'Creating…'
                  : 'Saving…'
                : mode === 'create'
                  ? 'Create folder'
                  : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
