'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Skeleton } from '@/components/ui/skeleton'
import { PositionBadge } from '@/components/players/position-badge'

export interface PlayerSearchResult {
  id: string
  sleeper_id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  status: string | null
  adp: number | null
}

interface PlayerSearchProps {
  position?: 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF'
  limit?: number
  placeholder?: string
  onSelect?: (player: PlayerSearchResult) => void
}

const INJURY_STATUSES = new Set([
  'Questionable',
  'Doubtful',
  'Out',
  'IR',
  'Injured Reserve',
  'PUP',
  'NFI',
  'Sus',
  'Suspended',
])

function isInjuryStatus(status: string | null | undefined): boolean {
  if (!status) return false
  return INJURY_STATUSES.has(status) || status.toLowerCase().includes('injur')
}

function injuryBadgeVariant(status: string): 'pink' | 'stroke-pink' {
  const s = status.toLowerCase()
  if (s.includes('out') || s.includes('ir') || s.includes('doubt')) return 'pink'
  return 'stroke-pink'
}

export function PlayerSearch({
  position,
  limit = 20,
  placeholder = 'Search players…',
  onSelect,
}: PlayerSearchProps) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [results, setResults] = useState<PlayerSearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(handle)
  }, [query])

  useEffect(() => {
    if (!debounced) {
      setResults([])
      setIsLoading(false)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsLoading(true)

    const params = new URLSearchParams({ q: debounced, limit: String(limit) })
    if (position) params.set('position', position)

    fetch(`/api/players/search?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Search failed: ${res.status}`)
        return res.json() as Promise<{ results: PlayerSearchResult[] }>
      })
      .then((data) => {
        setResults(data.results ?? [])
        setIsLoading(false)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        console.error(err)
        setResults([])
        setIsLoading(false)
      })

    return () => controller.abort()
  }, [debounced, limit, position])

  const showSkeleton = isLoading && debounced.length > 0
  const showEmpty = !isLoading && debounced.length > 0 && results.length === 0

  const skeletons = useMemo(
    () =>
      Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="h-8 w-8" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      )),
    [],
  )

  return (
    <Command shouldFilter={false} className="rounded-sm border border-ink">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={placeholder}
      />
      <CommandList>
        {showSkeleton && <div className="p-1">{skeletons}</div>}
        {showEmpty && <CommandEmpty>No players found.</CommandEmpty>}
        {!showSkeleton && results.length > 0 && (
          <CommandGroup>
            {results.map((player) => (
              <CommandItem
                key={player.id}
                value={`${player.full_name} ${player.team ?? ''} ${player.position}`}
                onSelect={() => onSelect?.(player)}
                className="flex items-center gap-3 py-2"
              >
                <Avatar className="h-8 w-8">
                  {player.headshot_url && (
                    <AvatarImage
                      src={player.headshot_url}
                      alt={player.full_name}
                      className="h-full w-full object-cover object-top"
                    />
                  )}
                  <AvatarFallback className="text-[9px]">
                    {player.full_name
                      .split(' ')
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join('')}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-extrabold">
                      {player.full_name}
                    </span>
                    {isInjuryStatus(player.status) && (
                      <Badge
                        variant={injuryBadgeVariant(player.status as string)}
                        className="h-[15px] px-1 text-[9px]"
                      >
                        {player.status}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <PositionBadge position={player.position} size="sm" />
                    {player.team && (
                      <span className="text-[10px] font-semibold text-n-3">
                        {player.team}
                      </span>
                    )}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
