'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'

import { ListRow } from '@/components/lists/list-row'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/hooks/use-auth'
import {
  type ListWithTags,
  useDeleteList,
  useDuplicateList,
  useLists,
  useToggleFavorite,
} from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import type { List } from '@/types/database'

type SortKey = 'added' | 'updated' | 'players' | 'alpha'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'added', label: 'Recently Added' },
  { value: 'updated', label: 'Recently Updated' },
  { value: 'players', label: 'Most Players' },
  { value: 'alpha', label: 'Alphabetical' },
]

const POSITION_FILTERS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX'] as const
type PositionFilter = (typeof POSITION_FILTERS)[number]

interface MyListsTabProps {
  /** When true, restrict the visible lists to favorited ones. */
  onlyFavorites?: boolean
}

export function MyListsTab({ onlyFavorites = false }: MyListsTabProps = {}) {
  const router = useRouter()
  const { toast } = useToast()
  const { user } = useAuth()
  const { data, isLoading, isError, error } = useLists(1, 100)
  const deleteList = useDeleteList()
  const duplicateList = useDuplicateList()
  const toggleFavorite = useToggleFavorite()

  const [sort, setSort] = useState<SortKey>('added')
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<PositionFilter>('All')
  const [tagSlug, setTagSlug] = useState<string>('')
  const [createdByMe, setCreatedByMe] = useState(false)

  const allLists = data?.lists ?? []
  const lists = onlyFavorites ? allLists.filter((l) => l.is_favorited) : allLists

  const userTags = useMemo(() => {
    const map = new Map<string, { slug: string; name: string }>()
    for (const list of allLists) {
      for (const tag of list.tags ?? []) {
        if (!map.has(tag.slug)) map.set(tag.slug, { slug: tag.slug, name: tag.name })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [allLists])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return lists.filter((list) => {
      if (q && !list.title.toLowerCase().includes(q)) return false
      if (position !== 'All' && list.position_filter !== position) return false
      if (tagSlug && !(list.tags ?? []).some((t) => t.slug === tagSlug)) return false
      if (createdByMe && user && list.owner_id !== user.id) return false
      return true
    })
  }, [lists, query, position, tagSlug, createdByMe, user])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    switch (sort) {
      case 'added':
        return copy.sort(
          (a, b) =>
            new Date(b.created_at ?? 0).getTime() -
            new Date(a.created_at ?? 0).getTime(),
        )
      case 'updated':
        return copy.sort(
          (a, b) =>
            new Date(b.updated_at ?? 0).getTime() -
            new Date(a.updated_at ?? 0).getTime(),
        )
      case 'players':
        return copy.sort((a, b) => (b.player_count ?? 0) - (a.player_count ?? 0))
      case 'alpha':
        return copy.sort((a, b) => a.title.localeCompare(b.title))
      default:
        return copy
    }
  }, [filtered, sort])

  const handleDelete = (list: List) => {
    if (list.is_big_board) return
    deleteList.mutate(list.id, {
      onSuccess: () => {
        toast({ title: 'List deleted', description: list.title })
      },
      onError: (err) => {
        toast({
          title: 'Could not delete list',
          description: err.message,
          variant: 'destructive',
        })
      },
    })
  }

  const handleDuplicate = (list: List) => {
    duplicateList.mutate(list.id, {
      onSuccess: (created) => {
        toast({
          title: 'Duplicated',
          description: `${list.title} → ${created.title}`,
        })
        router.push(`/app/lists/${created.id}`)
      },
      onError: (err) => {
        toast({
          title: 'Could not duplicate',
          description: err.message,
          variant: 'destructive',
        })
      },
    })
  }

  const clearFilters = () => {
    setQuery('')
    setPosition('All')
    setTagSlug('')
    setCreatedByMe(false)
  }

  if (isLoading) {
    return <div className="text-sm text-text-secondary">Loading your lists…</div>
  }

  if (isError) {
    return (
      <Card className="border-bg-elevated-2 bg-bg-elevated">
        <CardContent className="p-6 text-sm text-destructive">
          {(error as Error)?.message ?? 'Failed to load lists.'}
        </CardContent>
      </Card>
    )
  }

  if (lists.length === 0) {
    return (
      <Card className="border-bg-elevated-2 bg-bg-elevated">
        <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          {onlyFavorites ? (
            <>
              <p className="text-sm text-text-secondary">
                No pinned lists yet. Pin a list from the All tab to find it
                here later.
              </p>
              <Button
                asChild
                variant="default"
                className="font-semibold"
              >
                <Link href="/app/lists">Show all lists</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-text-secondary">
                You haven&apos;t created any lists yet.
              </p>
              <Button asChild className="font-semibold">
                <Link href="/app/lists/new">Create your first list</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-full border border-bg-elevated-2 bg-bg-elevated-3 px-3">
          <Search className="h-4 w-4 text-text-tertiary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search lists…"
            className="h-full flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-text-tertiary"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="rounded-full text-text-tertiary transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <select
          value={tagSlug}
          onChange={(e) => setTagSlug(e.target.value)}
          className="h-9 rounded-full border border-bg-elevated-2 bg-bg-elevated-3 px-3 text-xs text-foreground focus:border-foreground focus:outline-none"
        >
          <option value="">All tags</option>
          {userTags.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.name}
            </option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-9 rounded-full border border-bg-elevated-2 bg-bg-elevated-3 px-3 text-xs text-foreground focus:border-foreground focus:outline-none"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {POSITION_FILTERS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPosition(p)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
              position === p
                ? 'bg-foreground text-background'
                : 'bg-bg-elevated-2 text-text-secondary hover:bg-bg-elevated-3 hover:text-foreground',
            )}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCreatedByMe((v) => !v)}
          aria-pressed={createdByMe}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
            createdByMe
              ? 'bg-foreground text-background'
              : 'bg-bg-elevated-2 text-text-secondary hover:bg-bg-elevated-3 hover:text-foreground',
          )}
        >
          Created by you
        </button>
        {(query || position !== 'All' || tagSlug || createdByMe) && (
          <button
            type="button"
            onClick={clearFilters}
            className="ml-auto text-xs text-text-tertiary hover:text-foreground"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="text-xs text-text-tertiary">
        Showing {sorted.length} of {lists.length} list
        {lists.length === 1 ? '' : 's'}
      </div>

      {sorted.length === 0 ? (
        <Card className="border-bg-elevated-2 bg-bg-elevated">
          <CardContent className="p-6 text-center text-sm text-text-secondary">
            No lists match your filters.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((list) => (
            <li key={list.id}>
              <ListRow
                list={list}
                firstPlayers={list.first_players}
                onDelete={() => handleDelete(list)}
                onDuplicate={() => handleDuplicate(list)}
                onToggleFavorite={() =>
                  toggleFavorite.mutate(list.id, {
                    onError: (err) =>
                      toast({
                        title: 'Could not update pin',
                        description: err.message,
                        variant: 'destructive',
                      }),
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export type { ListWithTags }
