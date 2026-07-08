'use client'

import Link from 'next/link'
import { Bot } from 'lucide-react'

import { PersonaBadge } from '@/components/personas/persona-badge'
import { UserAvatar } from '@/components/ui/user-avatar'
import { usePersonaBoards, usePersonaPosts } from '@/hooks/use-persona-boards'

function formatRelative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

/** Shelf entry: a ranking board or a published post, merged by recency. */
type ShelfItem =
  | {
      type: 'board'
      id: string
      title: string
      href: string
      meta: string
      date: string
      persona: { username: string; display_name: string; avatar_url: string | null }
    }
  | {
      type: 'post'
      id: string
      title: string
      href: string
      meta: string
      date: string
      persona: { username: string; display_name: string; avatar_url: string | null }
    }

/**
 * Home shelf: the AI experts' latest content — ranking boards and published
 * posts, merged newest-first. Hidden entirely until anything exists.
 */
export function AiExpertShelf() {
  const boards = usePersonaBoards(9)
  const posts = usePersonaPosts(6)

  if (boards.isLoading || posts.isLoading) return null

  const items: ShelfItem[] = [
    ...(boards.data ?? []).map((board): ShelfItem => ({
      type: 'board',
      id: `board-${board.id}`,
      title: board.title,
      href: `/u/${board.owner.username}/lists/${board.slug}`,
      meta: `${board.player_count} players`,
      date: board.updated_at,
      persona: board.persona,
    })),
    ...(posts.data ?? []).map((post): ShelfItem => ({
      type: 'post',
      id: `post-${post.id}`,
      title: post.title,
      href: `/personas/${post.persona.username}/posts/${post.slug}`,
      meta: 'Post',
      date: post.published_at ?? '',
      persona: post.persona,
    })),
  ]
    .sort((a, b) => (b.date > a.date ? 1 : -1))
    .slice(0, 9)

  if (items.length === 0) return null

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
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="group block rounded-lg bg-bg-elevated p-3 transition-colors hover:bg-bg-elevated-2"
            >
              <div className="flex items-center gap-2">
                <UserAvatar
                  src={item.persona.avatar_url ?? undefined}
                  alt={item.persona.display_name}
                  name={item.persona.display_name}
                  className="h-6 w-6 shrink-0"
                />
                <span className="truncate text-xs font-medium text-text-secondary">
                  {item.persona.display_name}
                </span>
                <PersonaBadge className="shrink-0" />
              </div>
              <p className="mt-2 truncate text-sm font-semibold group-hover:text-foreground">
                {item.title}
              </p>
              <p className="mt-1 text-xs text-text-tertiary">
                {item.meta}
                {item.date && <> · {formatRelative(item.date)}</>}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
