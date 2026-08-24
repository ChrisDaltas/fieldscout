'use client'

import { notFound } from 'next/navigation'
import { useState } from 'react'

import { MockLaunchDialog } from '@/components/draft/mock-launch-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { Draft } from '@/types/database'

/**
 * DEV-ONLY harness for the MP.4 launch dialog — the `dev-pro-menu-item` /
 * `api/dev/toggle-pro` pattern (`process.env.NODE_ENV`, never a feature
 * flag: this is not a surface anyone releases).
 *
 * It exists because MP.4 builds the dialog and nothing that mounts it:
 * **MP.5 owns `/app/mocks` and the `mockDrafts` flag, MP.6 owns the room
 * route, MP.7 owns the Home chip.** Building any of those here to get a
 * browser check would be this task taking three other tasks' surfaces. So
 * the harness is the smallest thing that makes the dialog drivable, and it
 * prints the created draft's `config` rather than navigating, because the
 * route to navigate TO does not exist yet.
 *
 * **DELETE THIS PAGE when MP.5 lands** — ledger row F115.
 */
export default function DevMockLaunchPage() {
  const [open, setOpen] = useState(false)
  const [launched, setLaunched] = useState<Draft | null>(null)

  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-[18px] font-extrabold">Dev — practice draft launcher</h1>
      <Button variant="blue" size="sm" shadow className="w-fit" onClick={() => setOpen(true)}>
        Open launch dialog
      </Button>

      {launched && (
        <Card>
          <CardContent className="p-4">
            <p className="text-[12px] font-bold">
              Launched {launched.draft_type} · {launched.id}
            </p>
            <pre className="mt-2 overflow-x-auto text-[11px]">
              {JSON.stringify(launched.config, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      <MockLaunchDialog
        open={open}
        onOpenChange={setOpen}
        onLaunched={(draft) => {
          setLaunched(draft)
          setOpen(false)
        }}
      />
    </div>
  )
}
