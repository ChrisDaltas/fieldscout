'use client'

import Link from 'next/link'

import { inAppListHref } from '@/components/mobile/community/community-ops'
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
      persona: { username: string; display_name: string; avatar_url: string | null }
    }
  | {
      type: 'post'
      id: string
      title: string
      href: string
      meta: string
      date: string
      positionFilter: null
      persona: { username: string; display_name: string; avatar_url: string | null }
    }

/**
 * Home shelf: the AI experts' latest content — ranking boards and published
 * posts, merged newest-first. Hidden entirely until anything exists.
 * FieldScout-only surface (not in v7) — given v7's Scout AI treatment: a
 * sunken grey panel with the blue-dot "Scout AI" label and a 19px headline,
 * holding one white card per item.
 *
 * The persona profiles and posts are release-gated (out of the 2026 go-live
 * scope), so with that flag off the shelf keeps the AI ranking boards — they
 * are lists, a launch surface — and drops the post cards and the "Meet the
 * experts" link rather than pointing at routes that 404.
 *
 * A board opens where a list opens in the app (`inAppListHref`, plan C8):
 * while Community is on, on Community's list page inside the app (plan C5);
 * otherwise on its share page, as before. A read that fails with nothing
 * loaded says so, with Try again — never a shelf that quietly isn't there;
 * a refetch that fails over boards already shown keeps them.
 */
export function AiExpertShelf() {
  const boards = usePersonaBoards(9)
  const posts = usePersonaPosts(6, featureFlags.personas)

  if (boards.isLoading || posts.isLoading) return null

  // Only a read that left NOTHING to show is an error here. A failed refetch
  // keeps the data it already had (React Query v5: isError with data), so
  // boards that loaded stay on screen rather than being swapped for the
  // error when a later background read fails.
  const boardsFailed = boards.isError && !boards.data
  const postsFailed = featureFlags.personas && posts.isError && !posts.data
  if (boardsFailed || postsFailed) {
    return (
      <ShelfFrame>
        <div className="flex flex-col items-center gap-[9px] rounded-xl bg-white px-[15px] py-6 text-center">
          <p className="text-[11px] font-medium text-negative-strong" role="alert">
            Couldn&apos;t load the AI experts.
          </p>
          <Button
            variant="stroke"
            size="sm"
            onClick={() => {
              if (boards.isError) void boards.refetch()
              if (posts.isError) void posts.refetch()
            }}
          >
            <Icon name="reset" size={11} /> Try again
          </Button>
        </div>
      </ShelfFrame>
    )
  }

  const items: ShelfItem[] = [
    ...(boards.data ?? []).map((board): ShelfItem => ({
      type: 'board',
      id: `board-${board.id}`,
      title: board.title,
      href: inAppListHref(board.id, featureFlags.community, {
        otherwise: `/u/${board.owner.username}/lists/${board.slug}`,
      }),
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
    <ShelfFrame>
      <ul className="grid grid-cols-1 gap-[10px] sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="block rounded-xl bg-white px-[13px] py-3 transition-shadow hover:shadow-hard-4"
            >
              <div className="flex items-center gap-1.5">
                <UserAvatar
                  src={item.persona.avatar_url ?? undefined}
                  alt={item.persona.display_name}
                  name={item.persona.display_name}
                  className="h-6 w-6 shrink-0"
                />
                <span className="truncate text-[10px] font-semibold text-n-3">
                  {item.persona.display_name}
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
              <p className="mt-2 truncate text-[13px] font-bold tracking-[-0.015em] text-ink">
                {item.title}
              </p>
              <p className="mt-0.5 truncate text-[10px] font-medium text-n-6">
                {item.meta}
                {item.date && <> · {formatRelative(item.date)}</>}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </ShelfFrame>
  )
}

/** The shelf's sunken panel, its Scout AI label and its title. */
function ShelfFrame({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-surface-sunken px-[19px] py-[17px]">
      <div className="flex flex-col gap-[7px]">
        <div className="flex items-center gap-[7px] text-[10px] font-semibold text-n-3">
          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          <span className="mr-auto">Scout AI · AI experts</span>
          {featureFlags.personas && (
            <Link
              href="/personas"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:text-accent-strong"
            >
              Meet the experts
              <Icon name="arrow-next" size={11} />
            </Link>
          )}
        </div>
        <h2 className="text-[19px] font-bold leading-[1.15] tracking-[-0.025em]">
          From the AI experts
        </h2>
      </div>
      {children}
    </section>
  )
}
