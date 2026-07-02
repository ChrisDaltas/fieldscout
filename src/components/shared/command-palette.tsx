'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  Calendar,
  ClipboardList,
  Compass,
  Home,
  ListOrdered,
  type LucideIcon,
  PieChart,
  Settings,
  Shield,
  Swords,
  Trophy,
  Vote,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { useUIStore } from '@/stores/ui-store'

interface PlayerHit {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  status: string | null
}

interface NavTarget {
  label: string
  href: string
  icon: LucideIcon
  keywords?: string
}

const NAV_TARGETS: NavTarget[] = [
  { label: 'Home', href: '/app', icon: Home, keywords: 'feed community' },
  { label: 'Explore', href: '/app/explore', icon: Compass },
  { label: 'Big Board', href: '/app/big-board', icon: ClipboardList },
  { label: 'Stats', href: '/app/stats', icon: PieChart },
  { label: 'Weekly Ranks', href: '/app/weekly-ranks', icon: Calendar },
  { label: 'Players', href: '/app/players', icon: Shield },
  { label: 'Lists', href: '/app/lists', icon: ListOrdered },
  { label: 'Research', href: '/app/research', icon: PieChart, keywords: 'stats table' },
  { label: 'Start or Sit', href: '/app/start-or-sit', icon: Vote },
  { label: 'Teams', href: '/app/teams', icon: Swords },
  { label: 'Leagues', href: '/app/leagues', icon: Trophy },
  { label: 'Settings', href: '/app/settings', icon: Settings },
]

export function CommandPalette() {
  const router = useRouter()
  const isOpen = useUIStore((s) => s.isCommandPaletteOpen)
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const toggle = useUIStore((s) => s.toggleCommandPalette)

  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [players, setPlayers] = useState<PlayerHit[]>([])
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
    }
  }, [isOpen])

  // Player search
  useEffect(() => {
    if (!debounced) {
      setPlayers([])
      setIsSearching(false)
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsSearching(true)

    const params = new URLSearchParams({ q: debounced, limit: '8' })
    fetch(`/api/players/search?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: { results: PlayerHit[] }) => {
        setPlayers(data.results ?? [])
        setIsSearching(false)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setIsSearching(false)
      })

    return () => controller.abort()
  }, [debounced])

  const navigate = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  const filteredNav = NAV_TARGETS.filter((target) => {
    if (!debounced) return true
    const q = debounced.toLowerCase()
    return (
      target.label.toLowerCase().includes(q) ||
      target.href.toLowerCase().includes(q) ||
      target.keywords?.toLowerCase().includes(q)
    )
  })

  return (
    <CommandDialog open={isOpen} onOpenChange={setOpen}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search players, lists, users…"
      />
      <CommandList>
        <CommandEmpty>
          {isSearching ? 'Searching…' : 'No matches'}
        </CommandEmpty>

        {players.length > 0 && (
          <CommandGroup heading="Players">
            {players.map((player) => (
              <CommandItem
                key={player.id}
                value={`player-${player.id}`}
                onSelect={() => navigate(`/app/players/${player.id}`)}
                className="gap-3"
              >
                <Avatar className="h-8 w-8">
                  {player.headshot_url && (
                    <AvatarImage src={player.headshot_url} alt={player.full_name} />
                  )}
                  <AvatarFallback className="text-[10px]">
                    {player.full_name
                      .split(' ')
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join('')}
                  </AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate font-medium">
                  {player.full_name}
                </span>
                <Badge
                  variant="default"
                  className="font-mono text-[10px] px-1.5 py-0"
                >
                  {player.position}
                </Badge>
                {player.team && (
                  <Badge
                    variant="default"
                    className="text-[10px] px-1.5 py-0"
                  >
                    {player.team}
                  </Badge>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {players.length > 0 && filteredNav.length > 0 && <CommandSeparator />}

        {filteredNav.length > 0 && (
          <CommandGroup heading="Go to">
            {filteredNav.map((target) => (
              <CommandItem
                key={target.href}
                value={`nav-${target.href}`}
                onSelect={() => navigate(target.href)}
                className="gap-3"
              >
                <target.icon className="h-4 w-4 text-text-secondary" />
                <span>{target.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
