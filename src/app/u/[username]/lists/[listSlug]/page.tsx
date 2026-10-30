import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import { ListAiNote } from '@/components/lists/list-ai-note'
import { PublicListView } from '@/components/lists/public-list-view'
import { inAppListHref, sharedListHandoff } from '@/components/mobile/community/community-ops'
import { PhoneHandoff } from '@/components/shared/phone-handoff'
import { featureFlags } from '@/lib/feature-flags'
import { fetchListLinks } from '@/lib/lists/links-service'
import { aggregateFantasyStats } from '@/lib/stats/aggregate-fantasy'
import { createServerClient } from '@/lib/supabase/server'

import type { ListPlayerWithPlayer, ListWithDetails } from '@/hooks/use-lists'

/**
 * The public share view — `/u/[username]/lists/[slug]`.
 *
 * **This page is a server component and must stay one** (delivery plan
 * **D7**, CLAUDE.md: "all public-facing pages must be server-rendered for
 * SEO"). Every query below runs on the server and the rows reach the browser
 * inside the initial HTML; `PublicListView` and the v2 components under it are
 * client components only so their *interaction* hydrates, never so their
 * content arrives late. Do not add `'use client'` here, and do not move the
 * fetch into a hook.
 *
 * The player SELECT deliberately matches `/api/lists/[id]`'s, column for
 * column, because the same `ListBody` renders both — a narrower select here
 * would silently render `—` in every stat cell on the one page strangers see.
 * Widening a SELECT is not a schema change and adds no route (plan §5 DoD 3).
 *
 * **Signed in, someone else's list, Community on** (plan C5): handed into
 * the app on EITHER layout — Community's list page (`sharedListHandoff`),
 * where they can like it, save it, follow the author and comment. A server
 * redirect, before anything else is read: the public page never flashes,
 * and it leaves no history entry for Back to return to.
 *
 * **On a phone otherwise** (audit lists-2, unchanged by C5) a signed-in
 * visitor is handed to the list's phone screen inside the app
 * (`PhoneHandoff`), where Back and the phone's light/dark come with it and
 * the owner's @handle opens their phone profile: your own list on the List
 * view with Edit, someone else's — Community off — on the List view,
 * read-only (`inAppListHref`, the one rule for where a list opens).
 *
 * This page stays what search engines and signed-out visitors get, and the
 * owner on desktop — the same split the public profile makes
 * (`/u/[username]`, audit profile-1).
 */

interface PageProps {
  params: Promise<{ username: string; listSlug: string }>
}

/**
 * Profile + list row only — everything `generateMetadata` needs.
 *
 * Split out on purpose: metadata used to run the *whole* load (players, tags,
 * and now stats and links as well), doubling every query on every request for
 * a title and a description that use none of them.
 */
async function loadListHeader(username: string, slug: string) {
  const supabase = await createServerClient()

  // A failed read throws (the segment's error.tsx says it couldn't load) —
  // never a false 404 (plan C4, readiness S13).
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .eq('username', username)
    .maybeSingle()
  if (profileError) throw new Error(`Couldn't load the profile: ${profileError.message}`)

  if (!profile) return null

  const { data: list, error: listError } = await supabase
    .from('lists')
    .select('*')
    .eq('owner_id', profile.id)
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle()
  if (listError) throw new Error(`Couldn't load the list: ${listError.message}`)

  // Private lists are unreachable here by two independent mechanisms: RLS on
  // `lists` hides them from everyone but the owner, and this check hides them
  // from the owner too — because this route is the *public* view of a list, and
  // an owner following their own share link should see what a stranger sees.
  // Either way the caller answers 404, never a partial render.
  if (!list || list.is_private) return null

  return { supabase, profile, list }
}

type ListHeader = NonNullable<Awaited<ReturnType<typeof loadListHeader>>>

/** The viewer, if signed in — read before the rest so a hand-off into the
 *  app (plan C5) happens before the page's own reads. */
async function viewerOf(header: ListHeader) {
  const {
    data: { user },
  } = await header.supabase.auth.getUser()
  return user
}

async function loadList(header: ListHeader, user: Awaited<ReturnType<typeof viewerOf>>) {
  const { supabase, profile, list } = header

  interface TagJoin {
    tag: { id: string; name: string; slug: string; is_system_tag: boolean } | null
  }

  const [
    { data: players, error: playersError },
    { data: tagRows, error: tagsError },
    { count: commentCount, error: commentsError },
    links,
  ] = await Promise.all([
      supabase
        .from('list_players')
        // `*` on the row so `tier` and `notes` come through, and the embedded
        // player carries exactly the columns the stat picker offers — the same
        // list `/api/lists/[id]` selects.
        .select(
          `*, player:players(id, full_name, position, team, headshot_url, status, adp,
             bye_week, sos, auction_value, projected_pts_ppr, projected_pts_half_ppr,
             projected_pts_standard)`,
        )
        .eq('list_id', list.id)
        .order('position', { ascending: true }),
      supabase
        .from('list_tags')
        .select('tag:tags(id, name, slug, is_system_tag)')
        .eq('list_id', list.id),
      supabase
        .from('list_comments')
        .select('id', { count: 'exact', head: true })
        .eq('list_id', list.id)
        .is('deleted_at', null),
      // Not caught: a links failure throws, exactly as `/api/lists/[id]` 500s on
      // one. The Details tab has a real "Nothing attached" empty state, and
      // rendering it because a query errored is the production bug CLAUDE.md
      // records by name — "a database error returned HTTP 200 with an empty
      // list, rendering an empty state instead of an error".
      fetchListLinks(supabase, list.id),
    ])
  // Any of these failing throws, never a board with no players, no tags or
  // "0 comments" (plan C4, readiness S13).
  const readError = playersError ?? tagsError ?? commentsError
  if (readError) throw new Error(`Couldn't load the list: ${readError.message}`)

  const flatTags = ((tagRows ?? []) as unknown as TagJoin[])
    .map((r) => r.tag)
    .filter((t): t is NonNullable<typeof t> => Boolean(t))

  const playerRows = (players ?? []) as unknown as ListPlayerWithPlayer[]

  let statsByPlayer: Awaited<ReturnType<typeof aggregateFantasyStats>> = new Map()
  try {
    statsByPlayer = await aggregateFantasyStats(
      supabase,
      playerRows.map((row) => row.player_id).filter(Boolean),
      'ppr',
    )
  } catch (err) {
    // Same call `/api/lists/[id]` makes, for the same reason: stats are a
    // column on a row, and a stats outage must not 404 someone's shared board.
    console.error('aggregateFantasyStats failed', err)
  }

  // Persona attribution: persona-owned lists carry the "Generated by
  // FieldScout AI" footer + disclaimer (spec-ai-expert-personas.md).
  let persona: { username: string; display_name: string } | null = null
  if (list.ai_persona_id) {
    const { data: personaRow, error: personaError } = await supabase
      .from('ai_personas')
      .select('username, display_name')
      .eq('id', list.ai_persona_id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle()
    // Never drop the "made by FieldScout AI" note because a read failed.
    if (personaError) throw new Error(`Couldn't load the list: ${personaError.message}`)
    persona = personaRow ?? null
  }

  // Server-authoritative, as `/api/lists/[id]` computes it — never derived on
  // the client, where it races session loading.
  const isOwner = Boolean(user && user.id === list.owner_id)

  let initialPinned = false
  let viewer: { username: string | null; avatarUrl: string | null } = {
    username: null,
    avatarUrl: null,
  }
  if (user) {
    const [{ data: fav, error: favError }, { data: viewerProfile, error: viewerError }] = await Promise.all([
      isOwner
        ? Promise.resolve({ data: null, error: null })
        : supabase
            .from('list_favorites')
            .select('list_id')
            .eq('user_id', user.id)
            .eq('list_id', list.id)
            .maybeSingle(),
      supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', user.id)
        .maybeSingle(),
    ])
    // Never "not pinned" because the read failed.
    const viewerReadError = favError ?? viewerError
    if (viewerReadError) throw new Error(`Couldn't load the list: ${viewerReadError.message}`)
    initialPinned = Boolean(fav)
    viewer = {
      username: viewerProfile?.username ?? null,
      avatarUrl: viewerProfile?.avatar_url ?? null,
    }
  }

  const detail: ListWithDetails = {
    ...list,
    is_owner: isOwner,
    players: playerRows.map((row) => ({
      ...row,
      stats: statsByPlayer.get(row.player_id) ?? null,
    })),
    tags: flatTags,
    links,
  }

  return {
    list: detail,
    persona,
    owner: { username: profile.username, avatarUrl: profile.avatar_url },
    viewer,
    signedIn: Boolean(user),
    isOwner,
    initialPinned,
    commentCount: commentCount ?? 0,
  }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username, listSlug } = await params
  const header = await loadListHeader(username, listSlug)
  if (!header) return { title: 'List not found' }
  const { list, profile } = header
  const handle = `@${profile.username}`
  return {
    title: `${list.title} by ${handle} · FieldScout`,
    description:
      list.description ??
      `${handle}'s ${list.title} — ${list.player_count} player${list.player_count === 1 ? '' : 's'}`,
    openGraph: {
      title: `${list.title} by ${handle}`,
      description: list.description ?? undefined,
    },
  }
}

export default async function PublicListPage({ params }: PageProps) {
  const { username, listSlug } = await params
  const header = await loadListHeader(username, listSlug)
  if (!header) notFound()

  const user = await viewerOf(header)
  // Someone signed in opening someone else's list while Community is on:
  // into the app, on either layout (plan C5). Outside any try — `redirect`
  // throws to do its work.
  const handoff = sharedListHandoff({
    communityOn: featureFlags.community,
    viewerId: user?.id ?? null,
    ownerId: header.list.owner_id,
    listId: header.list.id,
  })
  if (handoff) redirect(handoff)

  const { list, owner, viewer, persona, signedIn, isOwner, initialPinned, commentCount } =
    await loadList(header, user)

  return (
    <GuestShell>
      {/* A signed-in phone opens this list as its phone screen, in the app. */}
      <PhoneHandoff to={inAppListHref(list.id, featureFlags.community, { own: isOwner })} />
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
        <PublicListView
          list={list}
          owner={owner}
          viewer={viewer}
          canPin={!isOwner}
          signedIn={signedIn}
          initialPinned={initialPinned}
          commentCount={commentCount}
        />
        {persona && <ListAiNote persona={persona} />}
      </div>
    </GuestShell>
  )
}
