'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ListOrdered, Search, User as UserIcon, X } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { UserAvatar } from '@/components/ui/user-avatar'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'

interface PlayerHit {
  id: string
  full_name: string
  position: string | null
  team: string | null
  headshot_url: string | null
}

interface CommunityUserHit {
  type: 'user'
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
}

interface CommunityListHit {
  type: 'list'
  id: string
  title: string
  slug: string
  owner_username: string | null
  position_filter: string | null
  player_count: number
}

export function TopSearch() {
  const router = useRouter()
  const openPalette = useUIStore((s) => s.setCommandPaletteOpen)

  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [focused, setFocused] = useState(false)
  const [communityResults, setCommunityResults] = useState<{
    lists: CommunityListHit[]
    users: CommunityUserHit[]
  }>({ lists: [], users: [] })
  const [playerResults, setPlayerResults] = useState<PlayerHit[]>([])

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 250ms debounce on the query so we don't fire on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(id)
  }, [query])

  // Close on outside click.
  useEffect(() => {
    if (!focused) return
    const onClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setFocused(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [focused])

  // Esc to close + clear.
  useEffect(() => {
    if (!focused) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFocused(false)
        inputRef.current?.blur()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [focused])

  // Fire both searches whenever the debounced query changes.
  useEffect(() => {
    if (!debounced) {
      setCommunityResults({ lists: [], users: [] })
      setPlayerResults([])
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const params = new URLSearchParams({ q: debounced, limit: '8' })
    const swallowAbort = (err: unknown) => {
      if (err instanceof Error && err.name !== 'AbortError') {
        // Silently degrade — the bar stays usable even if a fetch fails.
      }
    }

    fetch(`/api/players/search?${params}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => setPlayerResults(data.results ?? []))
      .catch(swallowAbort)

    fetch(`/api/search/community?${params}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) =>
        setCommunityResults({
          lists: data.lists ?? [],
          users: data.users ?? [],
        }),
      )
      .catch(swallowAbort)

    return () => controller.abort()
  }, [debounced])

  const open = focused && debounced.length > 0
  const hasResults =
    playerResults.length +
      communityResults.lists.length +
      communityResults.users.length >
    0

  const navigate = useCallback(
    (href: string) => {
      setFocused(false)
      setQuery('')
      router.push(href)
    },
    [router],
  )

  const active = focused || query.length > 0

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div
        className={cn(
          'flex h-10 items-center gap-2 rounded-full bg-bg-elevated-2 px-4 text-sm transition-colors',
          active
            ? 'bg-bg-elevated-3 ring-1 ring-foreground/40'
            : 'hover:bg-bg-elevated-3',
        )}
      >
        <Search className="h-4 w-4 text-text-tertiary" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="Search players, lists, users…"
          className="h-full flex-1 bg-transparent text-foreground outline-none placeholder:text-text-tertiary"
          aria-label="Search"
        />
        {query && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
            className="text-text-tertiary transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => openPalette(true)}
          aria-label="Open command palette"
          title="Open command palette"
          className="hidden rounded-full bg-bg-elevated-3/60 px-1.5 py-0.5 text-[10px] font-mono text-text-tertiary transition-colors hover:text-foreground sm:inline"
        >
          ⌘K
        </button>
      </div>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[420px] overflow-y-auto rounded-lg border border-bg-elevated-2 bg-bg-elevated shadow-2xl shadow-black/40"
        >
          {!hasResults && (
            <p className="px-4 py-6 text-center text-xs text-text-tertiary">
              No matches yet.
            </p>
          )}
          <PlayerResults results={playerResults} onNavigate={navigate} />
          <CommunityResults results={communityResults} onNavigate={navigate} />
        </div>
      )}
    </div>
  )
}

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="border-b border-bg-elevated-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
      {label}
    </p>
  )
}

function CommunityResults({
  results,
  onNavigate,
}: {
  results: { lists: CommunityListHit[]; users: CommunityUserHit[] }
  onNavigate: (href: string) => void
}) {
  return (
    <>
      {results.lists.length > 0 && (
        <div>
          <SectionHeader label="Lists" />
          <ul>
            {results.lists.map((list) => (
              <li key={`list:${list.id}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onNavigate(`/app/lists/${list.id}`)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-bg-elevated-2"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-elevated-3 text-text-secondary">
                    <ListOrdered className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">
                      {list.title}
                    </span>
                    <span className="block truncate text-[10px] text-text-tertiary">
                      {list.owner_username
                        ? `by @${list.owner_username}`
                        : 'List'}
                      {list.player_count > 0 && ` · ${list.player_count} players`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {results.users.length > 0 && (
        <div>
          <SectionHeader label="Users" />
          <ul>
            {results.users.map((u) => (
              <li key={`user:${u.id}`}>
                <Link
                  href={`/u/${u.username}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onNavigate(`/u/${u.username}`)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-bg-elevated-2"
                >
                  <UserAvatar
                    src={u.avatar_url}
                    name={u.display_name ?? u.username}
                    className="h-7 w-7 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">
                      {u.display_name ?? u.username}
                    </span>
                    <span className="block truncate text-[10px] text-text-tertiary">
                      @{u.username}
                    </span>
                  </span>
                  <UserIcon className="h-3.5 w-3.5 text-text-tertiary" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function PlayerResults({
  results,
  onNavigate,
}: {
  results: PlayerHit[]
  onNavigate: (href: string) => void
}) {
  if (results.length === 0) return null
  return (
    <div>
      <SectionHeader label="Players" />
      <ul>
        {results.map((player) => {
        const initials = player.full_name
          .split(' ')
          .map((n) => n[0])
          .filter(Boolean)
          .slice(0, 2)
          .join('')
        return (
          <li key={player.id}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onNavigate(`/app/players?id=${player.id}`)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-bg-elevated-2"
            >
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarImage
                  src={player.headshot_url ?? undefined}
                  alt={player.full_name}
                />
                <AvatarFallback className="text-[10px]">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">
                  {player.full_name}
                </span>
                <span className="block truncate text-[10px] text-text-tertiary">
                  {[player.position, player.team].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          </li>
        )
      })}
      </ul>
    </div>
  )
}

