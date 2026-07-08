'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { listsKeys } from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'

import type { List } from '@/types/database'

/**
 * Trash — soft-deleted lists with restore. Deletes stay soft platform-wide
 * (business rule: never hard-delete), so restore is the only action here;
 * there is deliberately no "delete forever".
 */
export default function TrashPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [lists, setLists] = useState<List[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/lists/trash')
      const body = (await res.json()) as { lists?: List[]; error?: string }
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`)
      setLists(body.lists ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const restore = async (list: List) => {
    if (busyId) return
    setBusyId(list.id)
    try {
      const res = await fetch(`/api/lists/${list.id}/restore`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Restore failed (${res.status})`)
      toast({ title: 'List restored', description: list.title })
      qc.invalidateQueries({ queryKey: listsKeys.all })
      setLists((cur) => cur.filter((l) => l.id !== list.id))
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
      {loading && (
        <Card>
          <ul>
            {Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="flex items-center gap-3 border-b border-n-4 px-card-pad py-3 last:border-0"
              >
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-2.5 w-24" />
                </div>
                <Skeleton className="h-btn-sm w-20" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {error && (
        <Card className="border-negative bg-negative-soft">
          <p className="p-card-pad text-[13px] font-bold text-negative-strong">
            {error}
          </p>
        </Card>
      )}

      {!loading && !error && lists.length === 0 && (
        <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <p className="text-h5 text-ink">Trash is empty</p>
          <p className="max-w-md text-[13px] font-medium text-n-3">
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
                className="flex items-center gap-3 border-b border-n-4 px-card-pad py-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-extrabold text-ink">
                    {list.title}
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold text-n-3">
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
          className="inline-flex items-center gap-1 text-[12px] font-bold text-n-3 transition-colors duration-200 ease-linear hover:text-ink"
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
