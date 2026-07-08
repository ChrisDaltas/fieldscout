'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, ChevronUp, Trash2, Undo2 } from 'lucide-react'

import { PersonaBadge } from '@/components/personas/persona-badge'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useToast } from '@/hooks/use-toast'

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

function personaOf(post: AdminPost) {
  const p = Array.isArray(post.persona) ? post.persona[0] : post.persona
  return p ?? { username: '', display_name: 'Unknown', avatar_url: null }
}

export default function AdminPostsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

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

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Persona posts — review queue</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Drafts from the content engine. Publishing makes a post public and
          SEO-indexable; takedown removes it everywhere immediately.
        </p>
      </header>

      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && (
        <p className="rounded-md bg-bg-elevated p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load.'}
        </p>
      )}

      {!isLoading && !error && (
        <>
          <PostGroup
            title={`Drafts (${drafts.length})`}
            posts={drafts}
            actions={(post) => (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  className="font-semibold"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ id: post.id, action: 'publish' })}
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Publish
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ id: post.id, action: 'takedown' })}
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Take down
                </Button>
              </>
            )}
          />
          <PostGroup
            title={`Published (${published.length})`}
            posts={published}
            actions={(post) => (
              <>
                <Link
                  href={`/personas/${personaOf(post).username}/posts/${post.slug}`}
                  className="text-xs font-medium text-text-secondary hover:text-foreground hover:underline"
                >
                  View live →
                </Link>
                <Button
                  size="sm"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ id: post.id, action: 'unpublish' })}
                >
                  <Undo2 className="mr-1 h-4 w-4" /> Unpublish
                </Button>
              </>
            )}
          />
        </>
      )}
    </div>
  )
}

function PostGroup({
  title,
  posts,
  actions,
}: {
  title: string
  posts: AdminPost[]
  actions: (post: AdminPost) => React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text-tertiary">
        {title}
      </h2>
      {posts.length === 0 ? (
        <p className="rounded-lg bg-bg-elevated p-4 text-sm text-text-secondary">
          Nothing here.
        </p>
      ) : (
        <ul className="space-y-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} actions={actions(post)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function PostCard({ post, actions }: { post: AdminPost; actions: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const persona = personaOf(post)
  return (
    <li className="rounded-lg bg-bg-elevated p-4">
      <div className="flex items-center gap-2">
        <UserAvatar
          src={persona.avatar_url ?? undefined}
          alt={persona.display_name}
          name={persona.display_name}
          className="h-6 w-6"
        />
        <span className="text-xs font-medium text-text-secondary">
          {persona.display_name}
        </span>
        <PersonaBadge />
        <span className="ml-auto text-xs text-text-tertiary">{post.kind}</span>
      </div>
      <p className="mt-2 text-base font-semibold">{post.title}</p>
      {post.dek && <p className="mt-1 text-sm text-text-secondary">{post.dek}</p>}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-foreground"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? 'Hide full post' : 'Read full post'}
      </button>
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-bg-elevated-2 pt-3">
          <pre className="whitespace-pre-wrap font-sans text-sm text-text-secondary">
            {post.body_md}
          </pre>
          {post.citations.length > 0 && (
            <div className="text-xs text-text-tertiary">
              Sources:{' '}
              {post.citations.map((c, i) =>
                /^https?:\/\//i.test(c.source_url) ? (
                  <a
                    key={i}
                    href={c.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    [{i + 1}]
                  </a>
                ) : (
                  <span key={i}>[{i + 1}: unsafe URL omitted]</span>
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
