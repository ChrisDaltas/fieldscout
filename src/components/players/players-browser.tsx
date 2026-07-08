'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { PlayerRow } from '@/components/players/player-row'
import { PositionBadge } from '@/components/players/position-badge'
import { Card, CardContent } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
const POSITION_LABELS: Record<PositionFilter, string> = {
  All: 'All',
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'K',
  DEF: 'D/ST',
}

interface PlayersBrowserProps {
  initialPosition?: PositionFilter
}

/** Simple browse list over `/api/players/search` — search + position tabs +
 *  flush player rows. The research table (`players-spreadsheet.tsx`) is the
 *  canonical Players surface; this stays a lightweight alternative. */
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
        <Skeleton key={i} className="h-14 w-full" />
      )),
    [],
  )

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex h-btn-md max-w-[272px] items-center gap-2 rounded-sm border border-ink bg-white px-2.5 transition-colors focus-within:border-accent">
          <Icon name="search" size={13} className="text-n-3" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="h-full flex-1 bg-transparent text-[12px] font-bold text-ink outline-none placeholder:text-n-3"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="text-n-3 transition-colors hover:text-ink"
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>

        <Tabs
          value={position}
          onValueChange={(v) => setPosition(v as PositionFilter)}
        >
          <TabsList className="flex-wrap">
            {POSITION_FILTERS.map((p) => (
              <TabsTrigger key={p} value={p}>
                {POSITION_LABELS[p]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {error && (
        <Card className="border-negative bg-negative-soft">
          <CardContent className="p-4 text-[13px] font-semibold text-negative-strong">
            {error}
          </CardContent>
        </Card>
      )}

      {showSkeletons ? (
        <div className="space-y-1">{skeletonRows}</div>
      ) : results.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-[13px] font-semibold text-n-3">
            {debounced
              ? `No players found for “${debounced}”${position !== 'All' ? ` in ${position}` : ''}.`
              : 'No players in this view.'}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-n-4">
            {results.map((player, i) => (
              <li key={player.id}>
                <PlayerRow
                  rank={i + 1}
                  player={player}
                  density="comfortable"
                  showRank={false}
                  onOpen={() => openPlayer(player.id)}
                  className="rounded-none"
                  trailing={
                    player.adp != null ? (
                      <span className="fs-num text-[12px] font-bold text-n-3">
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
        </Card>
      )}

      <p className="pt-2 text-center text-[11px] font-medium text-n-3">
        Showing up to 50 players. Use search or position filters to narrow the list.
      </p>
    </div>
  )
}
