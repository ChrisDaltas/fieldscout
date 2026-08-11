'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { PositionBadge } from '@/components/players/position-badge'
import { PlayerAvatarImage } from '@/components/players/player-image'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Icon, type IconName } from '@/components/ui/icon'
import { UserAvatar } from '@/components/ui/user-avatar'
import { featureFlags } from '@/lib/feature-flags'
import { useUIStore } from '@/stores/ui-store'

interface PlayerHit {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  status: string | null
}

interface UserHit {
  type: 'user'
  id: string
  username: string
  avatar_url: string | null
}

interface ListHit {
  type: 'list'
  id: string
  title: string
  slug: string
  owner_username: string | null
  position_filter: string | null
  player_count: number
}

interface NavTarget {
  label: string
  href: string
  icon: IconName
  keywords?: string
}

// Quick-nav targets mirror the sidebar IA (routes stay as-is during the
// reskin — docs/redesign-plan.md D1/D2). Release-gated surfaces drop out so
// the palette never offers a route that 404s.
const NAV_TARGETS: NavTarget[] = [
  { label: 'Home', href: '/app', icon: 'dashboard', keywords: 'hub feed' },
  ...(featureFlags.community
    ? [
        {
          label: 'Community',
          href: '/app/explore',
          icon: 'team',
          keywords: 'explore social feed',
        } as NavTarget,
      ]
    : []),
  ...(featureFlags.bigBoard
    ? [{ label: 'Big board', href: '/app/big-board', icon: 'level' } as NavTarget]
    : []),
  ...(featureFlags.weeklyRanks
    ? [
        {
          label: 'Weekly ranks',
          href: '/app/weekly-ranks',
          icon: 'calendar',
        } as NavTarget,
      ]
    : []),
  { label: 'My stats', href: '/app/stats', icon: 'chart', keywords: 'cred accuracy' },
  {
    label: 'Players',
    href: '/app/research',
    icon: 'table',
    keywords: 'research stats browse',
  },
  { label: 'Lists', href: '/app/lists', icon: 'list' },
  ...(featureFlags.startOrSit
    ? [{ label: 'Start or sit', href: '/app/start-or-sit', icon: 'sort' } as NavTarget]
    : []),
  ...(featureFlags.teams
    ? [{ label: 'Teams', href: '/app/teams', icon: 'layers' } as NavTarget]
    : []),
  // Leagues are release-gated (mock UI until the league backend ships).
  ...(featureFlags.leagues
    ? [{ label: 'Leagues', href: '/app/leagues', icon: 'cup' } as NavTarget]
    : []),
  { label: 'Settings', href: '/app/settings', icon: 'setup', keywords: 'account' },
]

/**
 * The search overlay — one surface for players, lists, users, and quick nav
 * on the reskinned Command primitives (white panel, ink border, accent-soft
 * active row). Opens via Cmd+K (here), "/" (sidebar), and the search
 * triggers in the sidebar, top bar, and bottom tabs.
 */
export function CommandPalette() {
  const router = useRouter()
  const isOpen = useUIStore((s) => s.isCommandPaletteOpen)
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const toggle = useUIStore((s) => s.toggleCommandPalette)

  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [players, setPlayers] = useState<PlayerHit[]>([])
  const [lists, setLists] = useState<ListHit[]>([])
  const [users, setUsers] = useState<UserHit[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggle])

  // Debounce query
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(id)
  }, [query])

  // Reset query when closed
  useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setPlayers([])
      setLists([])
      setUsers([])
    }
  }, [isOpen])

  // Live search: players + community (lists, users)
  useEffect(() => {
    if (!debounced) {
      setPlayers([])
      setLists([])
      setUsers([])
      setIsSearching(false)
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsSearching(true)

    const params = new URLSearchParams({ q: debounced, limit: '8' })
    const playersReq = fetch(`/api/players/search?${params}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: { results?: PlayerHit[] }) => setPlayers(data.results ?? []))
    const communityReq = fetch(`/api/search/community?${params}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: { lists?: ListHit[]; users?: UserHit[] }) => {
        setLists(data.lists ?? [])
        setUsers(data.users ?? [])
      })

    Promise.allSettled([playersReq, communityReq]).then(() => {
      if (!controller.signal.aborted) setIsSearching(false)
    })

    return () => controller.abort()
  }, [debounced])

  const navigate = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  const hasHits = players.length + lists.length + users.length > 0

  return (
    <CommandDialog open={isOpen} onOpenChange={setOpen}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search players, lists, users…"
      />
      <CommandList>
        <CommandEmpty>{isSearching ? 'Searching…' : 'No matches'}</CommandEmpty>

        {players.length > 0 && (
          <CommandGroup heading="Players">
            {players.map((player) => (
              <CommandItem
                key={player.id}
                value={`${player.full_name} ${player.id}`}
                onSelect={() => navigate(`/app/players/${player.id}`)}
                className="gap-2.5"
              >
                <Avatar className="h-6 w-6">
                  <PlayerAvatarImage player={player} alt={player.full_name} />
                  <AvatarFallback className="text-[9px]">
                    {initialsOf(player.full_name)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate font-extrabold">
                  {player.full_name}
                </span>
                <PositionBadge position={player.position} size="sm" />
                {player.team && (
                  <span className="text-[11px] font-semibold text-n-3">
                    {player.team}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {lists.length > 0 && (
          <CommandGroup heading="Lists & rankings">
            {lists.map((list) => (
              <CommandItem
                key={list.id}
                value={`${list.title} ${list.id}`}
                onSelect={() => navigate(`/app/lists/${list.id}`)}
                className="gap-2.5"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-ink bg-n-4 text-ink">
                  <Icon name="list" size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{list.title}</span>
                  <span className="block truncate text-[11px] font-medium text-n-3">
                    {list.owner_username ? `by @${list.owner_username}` : 'List'}
                    {list.player_count > 0 && (
                      <>
                        {' · '}
                        <span className="fs-num">{list.player_count}</span> players
                      </>
                    )}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {users.length > 0 && (
          <CommandGroup heading="Users">
            {users.map((u) => (
              <CommandItem
                key={u.id}
                value={`${u.username} ${u.id}`}
                onSelect={() => navigate(`/u/${u.username}`)}
                className="gap-2.5"
              >
                <UserAvatar
                  src={u.avatar_url}
                  name={u.username}
                  className="h-6 w-6 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">@{u.username}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {hasHits && <CommandSeparator />}

        <CommandGroup heading="Go to">
          {NAV_TARGETS.map((target) => (
            <CommandItem
              key={target.href}
              value={`${target.label} ${target.keywords ?? ''} ${target.href}`}
              onSelect={() => navigate(target.href)}
              className="gap-2.5"
            >
              <Icon name={target.icon} size={14} className="text-n-3" />
              <span>{target.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
}
