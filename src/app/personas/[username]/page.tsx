import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import { PersonaBadge } from '@/components/personas/persona-badge'
import { PublicListCard } from '@/components/lists/public-list-card'
import { UserAvatar } from '@/components/ui/user-avatar'
import { personaDisclaimer } from '@/lib/personas/roster'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Public, server-rendered persona profile (SEO). Lives outside /app/ next to
 * the other public surfaces (/u/[username], /consensus, /tag) — the spec's
 * app/(main)/personas path predates the actual route layout.
 */

interface PageProps {
  params: Promise<{ username: string }>
}

async function loadPersona(username: string) {
  const supabase = await createServerClient()

  const { data: persona } = await supabase
    .from('ai_personas')
    .select('id, username, display_name, bio, avatar_url, is_active')
    .eq('username', username)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (!persona) return null

  const [{ data: lists }, { data: posts }] = await Promise.all([
    supabase
      .from('lists')
      .select(
        'id, title, slug, description, position_filter, like_count, player_count, updated_at, owner:profiles!lists_owner_id_fkey(username)',
      )
      .eq('ai_persona_id', persona.id)
      .eq('is_private', false)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(20),
    // RLS exposes only published, non-deleted posts to anon reads.
    supabase
      .from('persona_posts')
      .select('id, title, slug, dek, published_at')
      .eq('ai_persona_id', persona.id)
      .order('published_at', { ascending: false })
      .limit(10),
  ])

  return { persona, lists: lists ?? [], posts: posts ?? [] }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username } = await params
  const data = await loadPersona(username)
  if (!data) return { title: 'Persona not found' }
  const { persona } = data
  return {
    title: `${persona.display_name} · FieldScout`,
    description: persona.bio,
  }
}

export default async function PersonaProfilePage({ params }: PageProps) {
  const { username } = await params
  const data = await loadPersona(username)
  if (!data) notFound()

  const { persona, lists, posts } = data

  return (
    <GuestShell>
      <div className="mx-auto max-w-4xl space-y-[19px]">
        <header className="rounded-2xl border border-n-4 bg-white p-[17px]">
          <div className="flex items-start gap-4">
            <UserAvatar
              src={persona.avatar_url ?? undefined}
              alt={persona.display_name}
              name={persona.display_name}
              className="h-16 w-16 shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[20px] font-bold tracking-[-0.03em] text-ink">
                  {persona.display_name}
                </h1>
                <PersonaBadge />
              </div>
              <p className="mt-0.5 text-[10px] font-semibold text-n-6">
                @{persona.username}
              </p>
              <p className="mt-2.5 text-[11px] font-medium leading-[1.5] text-n-3">
                {persona.bio}
              </p>
            </div>
          </div>
        </header>

        {/* AI disclosure — a v7 Scout AI panel (sunken, blue-dot label). */}
        <div className="flex flex-col gap-1.5 rounded-2xl bg-surface-sunken px-[19px] py-[15px]">
          <span className="flex items-center gap-[7px] text-[10px] font-semibold text-n-3">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
            Scout AI
          </span>
          <p className="text-[11px] font-medium leading-[1.5] text-n-3">
            {personaDisclaimer(persona.display_name)}
          </p>
        </div>

        {posts.length > 0 && (
          <section>
            <h2 className="mb-2.5 text-[14px] font-bold tracking-[-0.015em] text-ink">Posts</h2>
            <ul className="space-y-2">
              {posts.map((post) => (
                <li key={post.id}>
                  <Link
                    href={`/personas/${persona.username}/posts/${post.slug}`}
                    className="block rounded-2xl border border-n-4 bg-white p-[15px] transition-shadow hover:shadow-hard-4"
                  >
                    <p className="text-[13px] font-bold text-ink">
                      {post.title}
                    </p>
                    {post.dek && (
                      <p className="mt-1 text-[11px] font-medium text-n-3">
                        {post.dek}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-2.5 text-[14px] font-bold tracking-[-0.015em] text-ink">Rankings</h2>
          {lists.length === 0 ? (
            <div className="rounded-2xl bg-surface-sunken px-6 py-14 text-center">
              <h3 className="text-[15px] font-bold tracking-[-0.02em] text-ink">
                No rankings published yet
              </h3>
              <p className="mx-auto mt-1 max-w-md text-[11px] font-medium text-n-6">
                {persona.display_name}&apos;s boards will show up here as soon
                as they publish.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {lists.map((list) => {
                const owner = Array.isArray(list.owner) ? list.owner[0] : list.owner
                const ownerUsername = (owner as { username?: string } | null)?.username
                return (
                  <li key={list.id}>
                    <PublicListCard
                      href={
                        ownerUsername
                          ? `/u/${ownerUsername}/lists/${list.slug}`
                          : `/personas/${persona.username}`
                      }
                      title={list.title}
                      description={list.description}
                      positionFilter={list.position_filter}
                      playerCount={list.player_count}
                      likeCount={list.like_count}
                      updatedAt={list.updated_at}
                      owner={{
                        username: persona.username,
                        name: persona.display_name,
                        avatar_url: persona.avatar_url,
                      }}
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <p className="text-center text-[10px] font-medium text-n-6">
          Generated by FieldScout AI ·{' '}
          <Link href="/" className="font-semibold text-accent hover:underline">
            fieldscout.gg
          </Link>
        </p>
      </div>
    </GuestShell>
  )
}
