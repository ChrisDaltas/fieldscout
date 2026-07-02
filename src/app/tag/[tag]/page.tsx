import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import { PublicListCard } from '@/components/lists/public-list-card'
import { createServerClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

interface PageProps {
  params: Promise<{ tag: string }>
  searchParams: Promise<{ sort?: string; page?: string }>
}

const PAGE_SIZE = 20

interface FeedListRow {
  id: string
  owner_id: string
  title: string
  slug: string
  description: string | null
  position_filter: string | null
  like_count: number
  view_count: number
  player_count: number
  is_private: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
  owner: {
    username: string
    display_name: string | null
    avatar_url: string | null
  }
}

async function loadFeed(slug: string, page: number, sort: 'recent' | 'popular') {
  const supabase = await createServerClient()

  const { data: tag } = await supabase
    .from('tags')
    .select('id, name, slug, is_system_tag, use_count')
    .eq('slug', slug)
    .maybeSingle()

  if (!tag) return null

  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  const orderColumn = sort === 'popular' ? 'like_count' : 'updated_at'

  const { data: rows, count } = await supabase
    .from('list_tags')
    .select(
      `list:lists!inner(
        id, owner_id, title, slug, description, position_filter,
        like_count, view_count, player_count, is_private, deleted_at,
        created_at, updated_at,
        owner:profiles!lists_owner_id_fkey(username, display_name, avatar_url)
      )`,
      { count: 'exact' },
    )
    .eq('tag_id', tag.id)
    .eq('list.is_private', false)
    .is('list.deleted_at', null)
    .order(`list(${orderColumn})`, { ascending: false })
    .range(from, to)

  const lists: FeedListRow[] = (
    (rows ?? []) as unknown as Array<{ list: FeedListRow | null }>
  )
    .map((r) => r.list)
    .filter((l): l is FeedListRow => Boolean(l))

  return {
    tag,
    lists,
    total: count ?? 0,
    hasMore: from + lists.length < (count ?? 0),
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tag } = await params
  const supabase = await createServerClient()
  const { data } = await supabase
    .from('tags')
    .select('name')
    .eq('slug', tag)
    .maybeSingle()
  if (!data) return { title: 'Tag not found' }
  return {
    title: `${data.name} · FieldScout`,
    description: `Public lists tagged ${data.name}`,
  }
}

export default async function TagFeedPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const [{ tag: slug }, qs] = await Promise.all([params, searchParams])
  const sort = qs.sort === 'popular' ? 'popular' : 'recent'
  const page = Math.max(1, parseInt(qs.page ?? '1', 10) || 1)

  const data = await loadFeed(slug, page, sort)
  if (!data) notFound()

  const { tag, lists, total, hasMore } = data

  return (
    <GuestShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            Tag
          </p>
          <h1 className="mt-1 text-2xl font-bold leading-tight">{tag.name}</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {total} public list{total === 1 ? '' : 's'} tagged{' '}
            <span className="font-semibold text-foreground">{tag.name}</span>
          </p>
        </header>

        <div className="flex items-center justify-between border-b border-bg-elevated-2 pb-2">
          <div className="flex gap-1">
            <SortLink slug={slug} sort="recent" active={sort === 'recent'}>
              Recent
            </SortLink>
            <SortLink slug={slug} sort="popular" active={sort === 'popular'}>
              Popular
            </SortLink>
          </div>
        </div>

        {lists.length === 0 ? (
          <p className="rounded-md border border-bg-elevated-2 bg-bg-elevated p-6 text-center text-sm text-text-secondary">
            No public lists tagged {tag.name} yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {lists.map((list) => (
              <li key={list.id}>
                <PublicListCard
                  href={`/u/${list.owner.username}/lists/${list.slug}`}
                  title={list.title}
                  description={list.description}
                  positionFilter={list.position_filter}
                  playerCount={list.player_count}
                  likeCount={list.like_count}
                  updatedAt={list.updated_at}
                  owner={list.owner}
                />
              </li>
            ))}
          </ul>
        )}

        {(page > 1 || hasMore) && (
          <nav className="flex items-center justify-between text-sm">
            <PaginationLink
              slug={slug}
              sort={sort}
              page={page - 1}
              disabled={page <= 1}
            >
              ← Newer
            </PaginationLink>
            <span className="text-xs text-text-tertiary">Page {page}</span>
            <PaginationLink
              slug={slug}
              sort={sort}
              page={page + 1}
              disabled={!hasMore}
            >
              Older →
            </PaginationLink>
          </nav>
        )}
      </div>
    </GuestShell>
  )
}

function SortLink({
  slug,
  sort,
  active,
  children,
}: {
  slug: string
  sort: 'recent' | 'popular'
  active: boolean
  children: React.ReactNode
}) {
  const href = sort === 'recent' ? `/tag/${slug}` : `/tag/${slug}?sort=popular`
  return (
    <Link
      href={href}
      className={cn(
        'relative px-3 py-2 text-sm font-medium transition-colors',
        active ? 'text-foreground' : 'text-text-secondary hover:text-foreground',
      )}
    >
      {children}
      {active && (
        <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-t bg-foreground" />
      )}
    </Link>
  )
}

function PaginationLink({
  slug,
  sort,
  page,
  disabled,
  children,
}: {
  slug: string
  sort: 'recent' | 'popular'
  page: number
  disabled?: boolean
  children: React.ReactNode
}) {
  const params = new URLSearchParams()
  if (sort === 'popular') params.set('sort', 'popular')
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  const href = qs ? `/tag/${slug}?${qs}` : `/tag/${slug}`

  if (disabled) {
    return (
      <span className="cursor-not-allowed text-text-tertiary">{children}</span>
    )
  }
  return (
    <Link
      href={href}
      className="text-text-secondary transition-colors hover:text-foreground"
    >
      {children}
    </Link>
  )
}
