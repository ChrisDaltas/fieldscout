'use client'

import Link from 'next/link'

import { PositionBadge } from '@/components/players/position-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { UserAvatar } from '@/components/ui/user-avatar'
import { usePersonaBoards, usePersonaPosts } from '@/hooks/use-persona-boards'
import { featureFlags } from '@/lib/feature-flags'

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
      positionFilter: string | null
      persona: { username: string; persona_name: string; avatar_url: string | null }
    }
  | {
      type: 'post'
      id: string
      title: string
      href: string
      meta: string
      date: string
      positionFilter: null
      persona: { username: string; persona_name: string; avatar_url: string | null }
    }

/**
 * Home shelf: the AI experts' latest content — ranking boards and published
 * posts, merged newest-first. Hidden entirely until anything exists.
 * FieldScout-only surface (not in the package mock) — styled per the hub's
 * white-card / ink-border language.
 *
 * The persona profiles and posts are release-gated (out of the 2026 go-live
 * scope), so with that flag off the shelf keeps the AI ranking boards — they
 * are lists, a launch surface — and drops the post cards and the "Meet the
 * experts" link rather than pointing at routes that 404.
 */
export function AiExpertShelf() {
  const boards = usePersonaBoards(9)
  const posts = usePersonaPosts(6, featureFlags.personas)

  if (boards.isLoading || posts.isLoading) return null

  const items: ShelfItem[] = [
    ...(boards.data ?? []).map((board): ShelfItem => ({
      type: 'board',
      id: `board-${board.id}`,
      title: board.title,
      href: `/u/${board.owner.username}/lists/${board.slug}`,
      meta: `${board.player_count} players`,
      date: board.updated_at,
      positionFilter: board.position_filter,
      persona: board.persona,
    })),
    ...(posts.data ?? []).map((post): ShelfItem => ({
      type: 'post',
      id: `post-${post.id}`,
      title: post.title,
      href: `/personas/${post.persona.username}/posts/${post.slug}`,
      meta: 'Post',
      date: post.published_at ?? '',
      positionFilter: null,
      persona: post.persona,
    })),
  ]
    .sort((a, b) => (b.date > a.date ? 1 : -1))
    .slice(0, 9)

  if (items.length === 0) return null

  return (
    <section>
      <div className="mb-2.5 flex items-center">
        <h2 className="mr-auto text-h5">From the AI experts</h2>
        {featureFlags.personas && (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/personas">
              Meet the experts
              <Icon name="arrow-next" />
            </Link>
          </Button>
        )}
      </div>

      <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="block rounded-sm border border-ink bg-white p-2.5 transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-4"
            >
              <div className="flex items-center gap-1.5">
                <UserAvatar
                  src={item.persona.avatar_url ?? undefined}
                  alt={item.persona.persona_name}
                  name={item.persona.persona_name}
                  className="h-6 w-6 shrink-0"
                />
                <span className="truncate text-[10px] font-bold text-n-3">
                  {item.persona.persona_name}
                </span>
                <Badge variant="stroke" className="ml-auto shrink-0">
                  AI
                </Badge>
                {item.positionFilter && (
                  <PositionBadge
                    position={item.positionFilter}
                    size="sm"
                    className="shrink-0"
                  />
                )}
              </div>
              <p className="mt-2 truncate text-[12px] font-extrabold">
                {item.title}
              </p>
              <p className="mt-0.5 truncate text-[10px] font-semibold text-n-3">
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
