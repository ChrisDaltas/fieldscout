'use client'

import { useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { FolderFormDialog } from '@/components/lists/folder-form-dialog'
import { GenerateAiButton } from '@/components/lists/generate-ai-button'
import { ListsBrowse } from '@/components/lists/lists-browse'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { useUIStore } from '@/stores/ui-store'

export default function ListsPage() {
  const openCreateList = useUIStore((s) => s.setCreateListOpen)
  const [newFolderOpen, setNewFolderOpen] = useState(false)

  return (
    <>
      <PageHeader
        title="Lists"
        actions={
          <div className="flex items-center gap-2.5">
            <GenerateAiButton size="sm" />
            <Button variant="stroke" size="sm" onClick={() => setNewFolderOpen(true)}>
              <Icon name="folder" size={13} /> New folder
            </Button>
            <Button
              variant="blue"
              size="sm"
              shadow
              onClick={() => openCreateList(true)}
            >
              <Icon name="plus" size={13} /> New list
            </Button>
          </div>
        }
      />

      <ListsBrowse />

      <FolderFormDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        mode="create"
      />
    </>
  )
}
