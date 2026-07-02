'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'

import { PlayerRow } from '@/components/players/player-row'
import { PositionBadge } from '@/components/players/position-badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

interface PlayerHit {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  status: string | null
  adp: number | null
}

const POSITION_FILTERS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
type PositionFilter = (typeof POSITION_FILTERS)[number]

interface PlayersBrowserProps {
  initialPosition?: PositionFilter
}

export function PlayersBrowser({ initialPosition = 'All' }: PlayersBrowserProps) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [position, setPosition] = useState<PositionFilter>(initialPosition)
  const [results, setResults] = useState<PlayerHit[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const openPlayer = usePlayerWindowsStore((s) => s.open)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(id)
  }, [query])

  // Default browse query — show top players by ADP if user hasn't typed.
  // We piggy-back on /api/players/search by passing a single-letter wildcard
  // (every name has at least one vowel) so the route's required `q` validation
  // is satisfied.
  const effectiveQuery = debounced || 'a'

  useEffect(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsLoading(true)
    setError(null)

    const params = new URLSearchParams({ q: effectiveQuery, limit: '50' })
    if (position !== 'All') params.set('position', position)

    fetch(`/api/players/search?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Search failed (${res.status})`)
        return res.json() as Promise<{ results: PlayerHit[] }>
      })
      .then((data) => {
        setResults(data.results ?? [])
        setIsLoading(false)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message)
        setIsLoading(false)
      })

    return () => controller.abort()
  }, [effectiveQuery, position])

  const showSkeletons = isLoading && results.length === 0
  const skeletonRows = useMemo(
    () =>
      Array.from({ length: 12 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-md" />
      )),
    [],
  )

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex h-9 items-center gap-2 rounded-full border border-bg-elevated-2 bg-bg-elevated-3 px-3">
          <Search className="h-4 w-4 text-text-tertiary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="h-full flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-text-tertiary"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-xs text-text-tertiary transition-colors hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
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
        </div>
      </div>

      {error && (
        <Card className="border-bg-elevated-2 bg-bg-elevated">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {showSkeletons ? (
        <div className="space-y-1">{skeletonRows}</div>
      ) : results.length === 0 ? (
        <Card className="border-bg-elevated-2 bg-bg-elevated">
          <CardContent className="p-6 text-center text-sm text-text-secondary">
            {debounced
              ? `No players found for “${debounced}”${position !== 'All' ? ` in ${position}` : ''}.`
              : 'No players in this view.'}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-0.5">
          {results.map((player, i) => (
            <li key={player.id}>
              <PlayerRow
                rank={i + 1}
                player={player}
                density="comfortable"
                showRank={false}
                onOpen={() => openPlayer(player.id)}
                trailing={
                  player.adp != null ? (
                    <span className="text-xs text-text-secondary tabular-nums">
                      ADP {Number(player.adp).toFixed(1)}
                    </span>
                  ) : (
                    <PositionBadge position={player.position} />
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}

      <p className="pt-2 text-center text-[10px] text-text-tertiary">
        Showing up to 50 players. Use search or position filters to narrow the list.
      </p>
    </div>
  )
}
