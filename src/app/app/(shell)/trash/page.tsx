'use client'

import Link from 'next/link'
import { useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileTrash } from '@/components/mobile/lists/mobile-trash'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useRestoreList, useTrashedLists } from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'

import type { List } from '@/types/database'

/**
 * Trash — soft-deleted lists with restore. Deletes stay soft platform-wide
 * (business rule: never hard-delete), so restore is the only action here;
 * there is deliberately no "delete forever".
 *
 * The phone draws its own screen on the same data and action
 * (`MobileTrash`, gap list §4 item 102); desktop is unchanged.
 */
export default function TrashPage() {
  return <ByLayout desktop={<DesktopTrash />} mobile={<MobileTrash />} />
}

function DesktopTrash() {
  const { toast } = useToast()
  const trash = useTrashedLists()
  const restoreList = useRestoreList()
  const [busyId, setBusyId] = useState<string | null>(null)

  const loading = trash.isPending
  const error = trash.error ? trash.error.message : null
  const lists = trash.data ?? []

  const restore = async (list: List) => {
    if (busyId) return
    setBusyId(list.id)
    try {
      await restoreList.mutateAsync(list.id)
      toast({ title: 'List restored', description: list.title })
    } catch (err) {
      toast({
        title: 'Could not restore',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-[19px]">
      {/* Explicit title on the standard header (F577, D487). */}
      <PageHeader title="Trash" />
      {loading && (
        <Card>
          <ul>
            {Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="flex items-center gap-3 border-b border-n-4 px-card-pad py-2.5 last:border-0"
              >
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/3 rounded-md bg-surface-control" />
                  <Skeleton className="h-2.5 w-24 rounded-md bg-surface-control" />
                </div>
                <Skeleton className="h-btn-sm w-20 rounded-pill bg-surface-control" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {error && (
        <Card className="border-negative-soft bg-negative-soft">
          <p className="p-card-pad text-[11px] font-semibold text-negative-strong">
            {error}
          </p>
        </Card>
      )}

      {!loading && !error && lists.length === 0 && (
        <Card className="flex flex-col items-center gap-1 px-6 py-16 text-center">
          <p className="text-[15px] font-bold tracking-[-0.02em] text-ink">Trash is empty</p>
          <p className="max-w-md text-[11px] font-medium text-n-6">
            Deleted lists land here so you can restore them later.
          </p>
        </Card>
      )}

      {!loading && lists.length > 0 && (
        <Card>
          <ul>
            {lists.map((list) => (
              <li
                key={list.id}
                className="flex items-center gap-3 border-b border-n-4 px-card-pad py-2.5 transition-colors last:border-0 hover:bg-surface-sunken"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-ink">
                    {list.title}
                  </p>
                  <p className="mt-0.5 text-[10px] font-semibold text-n-6">
                    Deleted{' '}
                    <span className="fs-num">
                      {list.deleted_at ? formatRelative(list.deleted_at) : ''}
                    </span>
                    {' · '}
                    <span className="fs-num">{list.player_count}</span> player
                    {list.player_count === 1 ? '' : 's'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="stroke"
                  disabled={busyId === list.id}
                  onClick={() => restore(list)}
                >
                  <Icon name="reset" size={13} />
                  {busyId === list.id ? 'Restoring…' : 'Restore'}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p>
        <Link
          href="/app/lists"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent transition-colors hover:text-accent-strong"
        >
          <Icon name="arrow-prev" size={13} />
          Back to lists
        </Link>
      </p>
    </div>
  )
}

function formatRelative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
