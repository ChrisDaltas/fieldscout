'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { listsKeys } from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'

import type { List } from '@/types/database'

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
    <div className="space-y-6">
      <header className="flex items-center gap-2">
        <Trash2 className="h-6 w-6 text-text-secondary" />
        <h1 className="text-2xl font-bold">Trash</h1>
      </header>

      {loading && (
        <p className="text-sm text-text-secondary">Loading deleted lists…</p>
      )}

      {error && (
        <Card className="border-bg-elevated-2 bg-bg-elevated">
          <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {!loading && !error && lists.length === 0 && (
        <Card className="border-bg-elevated-2 bg-bg-elevated">
          <CardContent className="p-8 text-center text-sm text-text-secondary">
            Trash is empty. Deleted lists land here so you can restore them later.
          </CardContent>
        </Card>
      )}

      {!loading && lists.length > 0 && (
        <ul className="space-y-1.5">
          {lists.map((list) => (
            <li
              key={list.id}
              className="flex items-center gap-3 rounded-md border border-bg-elevated-2 bg-bg-elevated px-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{list.title}</p>
                <p className="mt-0.5 text-xs text-text-tertiary">
                  Deleted {list.deleted_at ? formatRelative(list.deleted_at) : ''}
                  {' · '}
                  {list.player_count} player{list.player_count === 1 ? '' : 's'}
                </p>
              </div>
              <Button
                size="sm"
                variant="default"
                disabled={busyId === list.id}
                onClick={() => restore(list)}
                className="border-bg-elevated-3 text-text-secondary hover:text-foreground"
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                {busyId === list.id ? 'Restoring…' : 'Restore'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-text-tertiary">
        <Link href="/app/lists" className="transition-colors hover:text-foreground">
          ← Back to My Lists
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
