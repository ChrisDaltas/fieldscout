'use client'

import Link from 'next/link'
import { Bot } from 'lucide-react'

import { PersonaBadge } from '@/components/personas/persona-badge'
import { UserAvatar } from '@/components/ui/user-avatar'
import { usePersonaBoards } from '@/hooks/use-persona-boards'

function formatRelative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

/**
 * Home shelf: the AI experts' latest ranking boards (persona-owned public
 * lists). Hidden entirely until boards exist. Persona posts (content engine)
 * will join this shelf when they ship.
 */
export function AiExpertShelf() {
  const { data, isLoading } = usePersonaBoards(9)

  if (isLoading || !data || data.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 flex items-center justify-between text-lg font-semibold">
        <span className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-foreground" />
          From the AI Experts
        </span>
        <Link
          href="/personas"
          className="text-xs font-medium text-text-secondary hover:text-foreground hover:underline"
        >
          Meet the experts →
        </Link>
      </h2>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((board) => (
          <li key={board.id}>
            <Link
              href={`/u/${board.owner.username}/lists/${board.slug}`}
              className="group block rounded-lg bg-bg-elevated p-3 transition-colors hover:bg-bg-elevated-2"
            >
              <div className="flex items-center gap-2">
                <UserAvatar
                  src={board.persona.avatar_url ?? undefined}
                  alt={board.persona.display_name}
                  name={board.persona.display_name}
                  className="h-6 w-6 shrink-0"
                />
                <span className="truncate text-xs font-medium text-text-secondary">
                  {board.persona.display_name}
                </span>
                <PersonaBadge className="shrink-0" />
              </div>
              <p className="mt-2 truncate text-sm font-semibold group-hover:text-foreground">
                {board.title}
              </p>
              <p className="mt-1 text-xs text-text-tertiary">
                {board.player_count} players
                {board.updated_at && <> · {formatRelative(board.updated_at)}</>}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
