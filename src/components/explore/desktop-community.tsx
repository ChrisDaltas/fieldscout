'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { CommunityListPage } from '@/components/explore/community-list-page'

/** The shell's scrolling main column (`AppShell`). */
const scrollRoot = () => document.querySelector<HTMLElement>('[data-app-main]')

/**
 * Desktop Community: the feed, or — at `?list=<id>`, the phone's address for
 * it (`communityDetailHref`) — someone else's list inside the app (plan C5).
 *
 * The feed stays mounted, hidden, while a list is open, so Back returns to it
 * exactly as it was: the same tab, topic, pages read and scroll position
 * (the shell's main column scrolls, so this keeps its place by hand). The
 * list opens at the top.
 */
export function DesktopCommunity({ feed }: { feed: React.ReactNode }) {
  const listId = useSearchParams().get('list')
  const listOpen = useRef(Boolean(listId))
  const feedScroll = useRef(0)
  // Whether the feed has been on screen — then a list was opened from it.
  const [sawFeed, setSawFeed] = useState(!listId)
  if (!listId && !sawFeed) setSawFeed(true)

  // Where the feed was scrolled to, while it's the one showing.
  useEffect(() => {
    const main = scrollRoot()
    if (!main) return
    const onScroll = () => {
      if (!listOpen.current) feedScroll.current = main.scrollTop
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => main.removeEventListener('scroll', onScroll)
  }, [])

  // Before paint: a list opens at the top; the feed comes back where it was.
  useLayoutEffect(() => {
    listOpen.current = Boolean(listId)
    const main = scrollRoot()
    if (main) main.scrollTop = listId ? 0 : feedScroll.current
  }, [listId])

  return (
    <>
      <div className={listId ? 'hidden' : undefined} data-community-feed>
        {feed}
      </div>
      {listId && <CommunityListPage key={listId} listId={listId} fromFeed={sawFeed} />}
    </>
  )
}
