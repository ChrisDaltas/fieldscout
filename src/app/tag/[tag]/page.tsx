import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import { PublicListCard } from '@/components/lists/public-list-card'
import { Icon } from '@/components/ui/icon'
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
        owner:profiles!lists_owner_id_fkey(username, avatar_url)
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
      <div className="mx-auto max-w-3xl space-y-5">
        <header>
          <p className="text-[10px] font-bold tracking-wider text-n-3">
            Tag
          </p>
          <h1 className="mt-1 text-h4">{tag.name}</h1>
          <p className="mt-1 text-[11px] font-semibold text-n-3">
            <span className="fs-num">{total}</span> public list
            {total === 1 ? '' : 's'} tagged{' '}
            <span className="font-bold text-ink">{tag.name}</span>
          </p>
        </header>

        <div className="flex gap-1.5">
          <SortLink slug={slug} sort="recent" active={sort === 'recent'}>
            Recent
          </SortLink>
          <SortLink slug={slug} sort="popular" active={sort === 'popular'}>
            Popular
          </SortLink>
        </div>

        {lists.length === 0 ? (
          <div className="rounded-sm border border-ink bg-white p-[19px] text-center">
            <p className="text-h6">No lists yet</p>
            <p className="mt-1 text-[11px] font-medium text-n-3">
              No public lists tagged {tag.name} yet — be the first.
            </p>
          </div>
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
          <nav className="flex items-center justify-between">
            <PaginationLink
              slug={slug}
              sort={sort}
              page={page - 1}
              disabled={page <= 1}
            >
              <Icon name="arrow-prev" size={12} /> Newer
            </PaginationLink>
            <span className="text-[10px] font-semibold text-n-3">
              Page <span className="fs-num">{page}</span>
            </span>
            <PaginationLink
              slug={slug}
              sort={sort}
              page={page + 1}
              disabled={!hasMore}
            >
              Older <Icon name="arrow-next" size={12} />
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
  // Boxed-tab treatment (ui/tabs recipe) as plain links so the page stays SSR.
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-tab items-center justify-center whitespace-nowrap rounded-sm border border-ink px-4 text-[11px] font-bold leading-none transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'bg-white text-ink hover:bg-n-4',
      )}
    >
      {children}
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
      <span className="inline-flex cursor-not-allowed items-center gap-1 text-[11px] font-bold text-n-3 opacity-40">
        {children}
      </span>
    )
  }
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-[11px] font-bold text-n-3 transition-colors hover:text-ink"
    >
      {children}
    </Link>
  )
}
