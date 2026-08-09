'use client'

import { useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { FolderFormDialog } from '@/components/lists/folder-form-dialog'
import { GenerateAiButton } from '@/components/lists/generate-ai-button'
import { ListsBrowse } from '@/components/lists/lists-browse'
import { ListsPageV2 } from '@/components/lists/v2/lists-page-v2'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { featureFlags } from '@/lib/feature-flags'
import { useUIStore } from '@/stores/ui-store'

// LV.1.1 (delivery-plan-lists-v2.md §4): route-level branch so the old and
// new Lists page can coexist. Flag OFF must render byte-for-byte today's
// page, so ListsPageLegacy below is that page unchanged — only given a name
// so it can sit behind the branch without breaking React's hook-order rules.
export default function ListsPage() {
  if (featureFlags.listsV2) {
    return <ListsPageV2 />
  }
  return <ListsPageLegacy />
}

function ListsPageLegacy() {
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
