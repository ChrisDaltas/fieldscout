'use client'

import Link from 'next/link'
import { useMemo } from 'react'

import { ListThumbnail } from '@/components/lists/list-thumbnail'
import { inAppListHref } from '@/components/mobile/community/community-ops'
import { MPosChip } from '@/components/mobile/ui/m-pos-chip'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useLists } from '@/hooks/use-lists'
import { usePersonaBoards, usePersonaPosts } from '@/hooks/use-persona-boards'
import { featureFlags } from '@/lib/feature-flags'
import { useHistoryStore } from '@/stores/history-store'

import { ageText } from './home-ops'
import { HomeNote, HomeSectionTitle } from './home-section'

/**
 * FieldScout Home content the mobile design doesn't show, kept (CLAUDE.md:
 * AI features are never dropped; "delete nothing") and set in the mobile
 * language below the designed sections: Recently viewed and the AI experts.
 *
 * The Scout AI card and Top waiver adds are NOT here, nor on desktop Home:
 * both were hard-coded samples (no insights source, no waiver feed), and
 * Chris removed them from phone and desktop Home (2026-10-15, gap list #15).
 * They come back only when a real source exists.
 */

const RECENT_ROWS = 6

/** Recently viewed lists (the history store, as on desktop). */
export function HomeRecentlyViewed() {
  const entries = useHistoryStore((s) => s.entries)
  const { data } = useLists(1, 100)
  const listsById = useMemo(() => new Map((data?.lists ?? []).map((l) => [l.id, l])), [data])
  const recent = useMemo(() => entries.filter((e) => e.type === 'list').slice(0, RECENT_ROWS), [entries])
  return (
    <section>
      <HomeSectionTitle title="Recently viewed" className="mt-6" />
      {recent.length === 0 ? (
        <HomeNote>Lists you open will show up here so you can pick up where you left off.</HomeNote>
      ) : (
        <div className="mt-1 flex flex-col">
          {recent.map((entry) => {
            const list = listsById.get(entry.href.split('/').pop() ?? '')
            const meta = list ? `${list.player_count} player${list.player_count === 1 ? '' : 's'}` : entry.subtitle
            return (
              <Link key={entry.href} href={entry.href} className="flex items-center gap-3 border-b border-m-b2 py-[9px]">
                {list ? (
                  <ListThumbnail
                    positionFilter={list.position_filter}
                    coverColor={list.cover_color}
                    isTeam={list.is_team ?? false}
                    imageUrl={list.thumbnail_url}
                    players={list.first_players}
                    size={36}
                  />
                ) : entry.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- stored thumbnail URL from the history entry
                  <img src={entry.imageUrl} alt="" className="size-9 flex-none rounded-[10px] object-cover" />
                ) : (
                  <span className="flex size-9 flex-none items-center justify-center rounded-[10px] bg-m-b1 text-m-t3" aria-hidden>
                    <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                      <path d="M3 4h10M3 8h10M3 12h6" />
                    </svg>
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-[14px] font-semibold leading-[17px] text-m-t1">{list?.title ?? entry.name}</span>
                  {meta && <span className="truncate text-[11px] font-medium leading-[14px] text-m-t3">{meta}</span>}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}

interface ExpertItem {
  id: string
  title: string
  href: string
  meta: string
  date: string
  positionFilter: string | null
  persona: { display_name: string; avatar_url: string | null }
}

/**
 * The AI experts' latest boards and posts (the desktop `AiExpertShelf`'s
 * reads and rules): hidden until anything exists; posts and "Meet the
 * experts" only while personas are released. A read that fails says so,
 * with Try again — never a shelf that quietly isn't there (plan C8).
 */
export function HomeAiExperts() {
  const boards = usePersonaBoards(9)
  const posts = usePersonaPosts(6, featureFlags.personas)
  if (boards.isLoading || posts.isLoading) return null
  if (boards.isError || posts.isError) {
    return (
      <section className="mt-6">
        <AiExpertsTitle />
        <HomeNote
          tone="error"
          action={{
            label: 'Try again',
            onClick: () => {
              if (boards.isError) void boards.refetch()
              if (posts.isError) void posts.refetch()
            },
          }}
        >
          Couldn’t load the AI experts.
        </HomeNote>
      </section>
    )
  }
  const now = Date.now()
  const items: ExpertItem[] = [
    ...(boards.data ?? []).map((b) => ({
      id: `board-${b.id}`,
      title: b.title,
      // Where the same board opens from search, a profile or a shared link
      // (audit lists-2): Community's list page while Community is on, else
      // the List view — never the desktop share page.
      href: inAppListHref(b.id, featureFlags.community),
      meta: `${b.player_count} players`,
      date: b.updated_at,
      positionFilter: b.position_filter,
      persona: b.persona,
    })),
    ...(posts.data ?? []).map((p) => ({
      id: `post-${p.id}`,
      title: p.title,
      href: `/personas/${p.persona.username}/posts/${p.slug}`,
      meta: 'Post',
      date: p.published_at ?? '',
      positionFilter: null,
      persona: p.persona,
    })),
  ]
    .sort((a, b) => (b.date > a.date ? 1 : -1))
    .slice(0, 6)
  if (items.length === 0) return null
  return (
    <section className="mt-6">
      <AiExpertsTitle />
      <div className="mt-1 flex flex-col">
        {items.map((item) => (
          <Link key={item.id} href={item.href} className="flex items-center gap-3 border-b border-m-b2 py-[9px]">
            <UserAvatar
              src={item.persona.avatar_url ?? undefined}
              alt={item.persona.display_name}
              name={item.persona.display_name}
              className="size-9 flex-none"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="truncate text-[14px] font-semibold leading-[17px] text-m-t1">{item.title}</span>
              <span className="truncate text-[11px] font-medium leading-[14px] text-m-t3">
                {item.persona.display_name} · {item.meta}
                {item.date && ` · ${ageText(item.date, now)}`}
              </span>
            </span>
            {item.positionFilter && <MPosChip pos={item.positionFilter} />}
            <span className="flex h-5 flex-none items-center rounded-pill bg-m-b2 px-2 text-[10px] font-semibold text-m-t3">AI</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

/** The AI experts shelf's label and title, with "Meet the experts" while
 *  personas are released. */
function AiExpertsTitle() {
  return (
    <>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold leading-[14px] text-m-t3">
        <span className="size-1.5 rounded-full bg-accent" aria-hidden />
        Scout AI · AI experts
      </span>
      <HomeSectionTitle
        title="From the AI experts"
        align="center"
        className="mt-1"
        right={
          featureFlags.personas ? (
            <Link href="/personas" className="-my-[7px] py-[7px] text-[13px] font-semibold leading-[16px] text-accent">
              Meet the experts
            </Link>
          ) : null
        }
      />
    </>
  )
}
