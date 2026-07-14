'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PersonaBadge } from '@/components/personas/persona-badge'
import { Badge, FilterChip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/**
 * Editorial review queue for AI persona posts (spec-ai-content-engine.md
 * review gate). Server routes enforce is_admin; this page just renders 403s
 * honestly if a non-admin wanders in.
 */

interface AdminPost {
  id: string
  kind: string
  title: string
  slug: string
  dek: string | null
  body_md: string
  citations: { claim: string; source_url: string }[]
  status: string | null
  published_at: string | null
  created_at: string | null
  deleted_at: string | null
  list_id: string | null
  persona:
    | { username: string; display_name: string; avatar_url: string | null }
    | { username: string; display_name: string; avatar_url: string | null }[]
    | null
}

type QueueView = 'drafts' | 'published'

function personaOf(post: AdminPost) {
  const p = Array.isArray(post.persona) ? post.persona[0] : post.persona
  return p ?? { username: '', display_name: 'Unknown', avatar_url: null }
}

export default function AdminPostsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [view, setView] = useState<QueueView>('drafts')

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-posts'],
    queryFn: async (): Promise<{ posts: AdminPost[] }> => {
      const res = await fetch('/api/admin/posts')
      if (res.status === 403 || res.status === 401) {
        throw new Error('You need admin access to review posts.')
      }
      if (!res.ok) throw new Error('Could not load posts.')
      return res.json()
    },
  })

  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'publish' | 'unpublish' | 'takedown' }) => {
      const res = await fetch(`/api/admin/posts/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error('Action failed.')
      return res.json()
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin-posts'] })
      toast({
        title:
          vars.action === 'publish'
            ? 'Post published'
            : vars.action === 'unpublish'
              ? 'Post unpublished'
              : 'Post taken down',
      })
    },
    onError: (err) =>
      toast({
        title: 'Action failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      }),
  })

  const posts = data?.posts ?? []
  const drafts = posts.filter((p) => p.status !== 'published' && !p.deleted_at)
  const published = posts.filter((p) => p.status === 'published' && !p.deleted_at)
  const shown = view === 'drafts' ? drafts : published

  return (
    <div className="mx-auto max-w-3xl space-y-[19px]">
      <header>
        <h1 className="text-h3">Persona posts</h1>
        <p className="mt-1 text-[13px] font-medium text-n-3">
          Review queue for the content engine. Publishing makes a post public
          and SEO-indexable; takedown removes it everywhere immediately.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          pressed={view === 'drafts'}
          onPressedChange={() => setView('drafts')}
        >
          Drafts
          <span className="fs-num">{drafts.length}</span>
        </FilterChip>
        <FilterChip
          pressed={view === 'published'}
          onPressedChange={() => setView('published')}
        >
          Published
          <span className="fs-num">{published.length}</span>
        </FilterChip>
      </div>

      {isLoading && (
        <div className="space-y-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}

      {error != null && (
        <div className="rounded-sm border border-negative-strong bg-negative-soft p-4">
          <p className="text-[13px] font-bold text-ink">Could not load the queue</p>
          <p className="mt-1 text-[13px] font-medium text-n-3">
            {error instanceof Error ? error.message : 'Failed to load.'}
          </p>
        </div>
      )}

      {!isLoading && !error && (
        <>
          {shown.length === 0 ? (
            <div className="rounded-sm border border-ink bg-white px-6 py-14 text-center">
              <h2 className="text-h5">
                {view === 'drafts' ? 'No drafts waiting' : 'Nothing published yet'}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-[13px] font-medium text-n-3">
                {view === 'drafts'
                  ? 'The content engine drops new drafts here for review.'
                  : 'Approve a draft and it shows up here, live on the site.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {shown.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  actions={
                    view === 'drafts' ? (
                      <>
                        <Button
                          size="sm"
                          variant="green"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: post.id, action: 'publish' })}
                        >
                          <Icon name="check" />
                          Publish
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: post.id, action: 'takedown' })}
                        >
                          <Icon name="remove" />
                          Take down
                        </Button>
                      </>
                    ) : (
                      <>
                        <Link
                          href={`/personas/${personaOf(post).username}/posts/${post.slug}`}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-n-3 transition-colors hover:text-accent hover:underline"
                        >
                          <Icon name="external-link" size={12} />
                          View live
                        </Link>
                        <Button
                          size="sm"
                          variant="stroke"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: post.id, action: 'unpublish' })}
                        >
                          <Icon name="repeat" />
                          Unpublish
                        </Button>
                      </>
                    )
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function PostCard({ post, actions }: { post: AdminPost; actions: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const persona = personaOf(post)
  return (
    <li className="rounded-sm border border-ink bg-white p-card-pad">
      <div className="flex items-center gap-2">
        <UserAvatar
          src={persona.avatar_url ?? undefined}
          alt={persona.display_name}
          name={persona.display_name}
          className="h-6 w-6 shrink-0"
        />
        <span className="truncate text-[11px] font-bold text-n-3">
          {persona.display_name}
        </span>
        <PersonaBadge />
        <Badge variant="stroke" className="ml-auto shrink-0">
          {post.kind}
        </Badge>
      </div>
      <p className="mt-2 text-[14px] font-extrabold text-ink">{post.title}</p>
      {post.dek && (
        <p className="mt-1 text-[12px] font-medium text-n-3">{post.dek}</p>
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-2 flex items-center gap-1 text-[11px] font-bold text-n-3 transition-colors hover:text-ink"
      >
        <Icon
          name="arrow-bottom"
          size={13}
          className={cn('transition-transform', expanded && 'rotate-180')}
        />
        {expanded ? 'Hide full post' : 'Read full post'}
      </button>
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-n-4 pt-3">
          <pre className="whitespace-pre-wrap font-sans text-[13px] font-medium leading-relaxed text-ink">
            {post.body_md}
          </pre>
          {post.citations.length > 0 && (
            <div className="text-[11px] font-semibold text-n-3">
              Sources:{' '}
              {post.citations.map((c, i) =>
                /^https?:\/\//i.test(c.source_url) ? (
                  <a
                    key={i}
                    href={c.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="fs-num underline hover:text-ink"
                  >
                    [{i + 1}]
                  </a>
                ) : (
                  <span key={i} className="fs-num">
                    [{i + 1}: unsafe URL omitted]
                  </span>
                ),
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">{actions}</div>
    </li>
  )
}
