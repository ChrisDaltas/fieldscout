import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import { PersonaBadge } from '@/components/personas/persona-badge'
import { Icon } from '@/components/ui/icon'
import { UserAvatar } from '@/components/ui/user-avatar'
import { personaDisclaimer } from '@/lib/personas/roster'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Public persona post (spec-ai-content-engine.md SEO surface). Server
 * rendered; RLS only exposes published, non-deleted posts to anon reads, so
 * drafts and takedowns 404 here by construction.
 */

interface PageProps {
  params: Promise<{ username: string; slug: string }>
}

interface Citation {
  claim: string
  source_url: string
  published_at: string | null
}

/** Citation URLs originate from ingested feeds (untrusted): only plain
 * http(s) may render as a clickable link. */
function isSafeHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

async function loadPost(username: string, slug: string) {
  const supabase = await createServerClient()

  const { data: persona } = await supabase
    .from('ai_personas')
    .select('id, username, display_name, avatar_url')
    .eq('username', username)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()
  if (!persona) return null

  const { data: post } = await supabase
    .from('persona_posts')
    .select('id, title, slug, dek, body_md, citations, published_at, list_id')
    .eq('ai_persona_id', persona.id)
    .eq('slug', slug)
    .maybeSingle()
  if (!post) return null

  let backingList: { slug: string; ownerUsername: string } | null = null
  if (post.list_id) {
    const { data: list } = await supabase
      .from('lists')
      .select('slug, owner:profiles!lists_owner_id_fkey(username)')
      .eq('id', post.list_id)
      .is('deleted_at', null)
      .maybeSingle()
    const owner = Array.isArray(list?.owner) ? list?.owner[0] : list?.owner
    if (list && owner) {
      backingList = { slug: list.slug as string, ownerUsername: (owner as { username: string }).username }
    }
  }

  return { persona, post, backingList }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username, slug } = await params
  const data = await loadPost(username, slug)
  if (!data) return { title: 'Post not found' }
  const { persona, post } = data
  return {
    title: `${post.title} · ${persona.display_name} · FieldScout`,
    description: post.dek ?? undefined,
    openGraph: {
      title: post.title,
      description: post.dek ?? undefined,
      type: 'article',
      publishedTime: post.published_at ?? undefined,
      authors: [persona.display_name],
    },
    twitter: {
      card: 'summary',
      title: post.title,
      description: post.dek ?? undefined,
    },
  }
}

/** Minimal markdown: "## " headings and blank-line paragraphs — the only
 * constructs the generator emits. No raw-HTML rendering surface. */
function renderBody(bodyMd: string) {
  return bodyMd.split(/\n{2,}/).map((block, i) => {
    const trimmed = block.trim()
    if (trimmed.startsWith('## ')) {
      return (
        <h2 key={i} className="mt-8 text-h5">
          {trimmed.slice(3)}
        </h2>
      )
    }
    return (
      <p key={i} className="mt-4 text-[14px] font-medium leading-relaxed text-ink">
        {trimmed}
      </p>
    )
  })
}

export default async function PersonaPostPage({ params }: PageProps) {
  const { username, slug } = await params
  const data = await loadPost(username, slug)
  if (!data) notFound()

  const { persona, post, backingList } = data
  const citations = (post.citations ?? []) as unknown as Citation[]

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.dek ?? undefined,
    datePublished: post.published_at ?? undefined,
    author: {
      '@type': 'Person',
      name: persona.display_name,
      description: personaDisclaimer(persona.display_name),
    },
  }

  return (
    <GuestShell>
      <article className="mx-auto max-w-2xl">
        <script
          type="application/ld+json"
          // Escape < so model/feed-influenced text can never emit </script>
          // (or any tag) inside this block — stored-XSS hardening.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
          }}
        />

        <header className="space-y-3">
          <Link
            href={`/personas/${persona.username}`}
            className="inline-flex items-center gap-2"
          >
            <UserAvatar
              src={persona.avatar_url ?? undefined}
              alt={persona.display_name}
              name={persona.display_name}
              className="h-8 w-8"
            />
            <span className="text-[13px] font-extrabold text-ink hover:underline hover:decoration-2 hover:underline-offset-2">
              {persona.display_name}
            </span>
            <PersonaBadge />
          </Link>
          <h1 className="text-h2">{post.title}</h1>
          {post.dek && (
            <p className="text-[14px] font-medium text-n-3">{post.dek}</p>
          )}
          {post.published_at && (
            <p className="text-[12px] font-semibold text-n-3">
              {new Date(post.published_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          )}
        </header>

        <div className="mt-2">{renderBody(post.body_md)}</div>

        {backingList && (
          <Link
            href={`/u/${backingList.ownerUsername}/lists/${backingList.slug}`}
            className="mt-6 flex items-center justify-between gap-2 rounded-sm border border-accent bg-accent-soft p-4 text-[13px] font-extrabold text-ink transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            View the full ranked list
            <Icon name="arrow-next" size={14} />
          </Link>
        )}

        {citations.length > 0 && (
          <section className="mt-6 border-t border-n-4 pt-4">
            <h2 className="text-h6">Sources</h2>
            <ul className="mt-2 space-y-1 text-[13px] font-medium">
              {citations.map((c, i) => (
                <li key={i} className="text-n-3">
                  {isSafeHttpUrl(c.source_url) ? (
                    <a
                      href={c.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-ink"
                    >
                      {c.claim}
                    </a>
                  ) : (
                    <span>{c.claim}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-6 border-t border-n-4 pt-4 text-[11px] font-medium text-n-3">
          {personaDisclaimer(persona.display_name)} Generated by FieldScout AI.
        </p>
      </article>
    </GuestShell>
  )
}
