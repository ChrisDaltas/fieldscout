'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { listsKeys } from '@/hooks/use-lists'
import type { ListFolder } from '@/types/database'

export const foldersKeys = {
  all: ['folders'] as const,
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed with ${res.status}`)
  }
  return (await res.json()) as T
}

export function useFolders() {
  return useQuery({
    queryKey: foldersKeys.all,
    queryFn: () =>
      fetch('/api/folders').then(jsonOrThrow<{ folders: ListFolder[] }>),
    select: (data) => data.folders,
  })
}

export function useCreateFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string }) =>
      fetch('/api/folders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }).then(jsonOrThrow<ListFolder>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: foldersKeys.all })
    },
  })
}

export function useUpdateFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      fetch(`/api/folders/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }).then(jsonOrThrow<ListFolder>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: foldersKeys.all })
    },
  })
}

export function useDeleteFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/folders/${id}`, { method: 'DELETE' }).then(
        jsonOrThrow<{ ok: boolean }>,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: foldersKeys.all })
      // Deleting a folder un-folders its lists.
      qc.invalidateQueries({ queryKey: listsKeys.all })
    },
  })
}

export async function uploadFolderThumbnail(
  folderId: string,
  file: File,
): Promise<ListFolder> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`/api/folders/${folderId}/thumbnail`, {
    method: 'POST',
    body: form,
  })
  return jsonOrThrow<ListFolder>(res)
}

/** Move a list into a folder (or out of one with folderId = null). */
export function useMoveListToFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      listId,
      folderId,
    }: {
      listId: string
      folderId: string | null
    }) =>
      fetch(`/api/lists/${listId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ folder_id: folderId }),
      }).then(jsonOrThrow<{ id: string }>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listsKeys.all })
      qc.invalidateQueries({ queryKey: foldersKeys.all })
    },
  })
}
