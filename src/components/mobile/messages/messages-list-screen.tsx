'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { BackPill, MobileScreen } from '@/components/mobile/ui/mobile-header'
import { useAuth } from '@/hooks/use-auth'
import { useLeagues } from '@/hooks/use-leagues'
import { useMobileMessagesDms, type MDmConversation } from '@/hooks/use-mobile-messages-dms'
import { featureFlags } from '@/lib/feature-flags'

import { ConversationRow, ConversationRowSkeleton, LeagueBoardRow } from './conversation-row'
import { MessagesAvatar } from './messages-avatar'
import { EMPTY_PILL, MessagesEmpty } from './messages-empty'
import { matchesName, previewLine, threadHref } from './messages-ops'
import { useMessagesStore } from './messages-store'

export const MESSAGES_EMPTY_TITLE = 'No messages yet'
export const BOARDS_ERROR = 'Couldn’t load your leagues’ message boards.'

/** The empty list's body — says only what this build can show. */
export function messagesEmptyBody(boards: boolean, dms: boolean): string {
  if (boards && dms) return 'Your leagues’ message boards and direct messages will show up here.'
  if (boards) return 'Your leagues’ message boards will show up here.'
  return 'Direct messages with your league-mates will show up here.'
}

/**
 * FieldScout Mobile — Messages (m-messages §2.1, S1). Back pill, the 28px
 * title, Search, the people row, then the conversation rows.
 *
 * Conversations only (Chris, ruling #22, 2026-10-15: "Trades should only be
 * shown within a league or DM chat"). The design's All / Trades control and
 * its cross-league Trades tab are not built: a league's trade offers live on
 * that league's Trades screen (League › Menu, a team page, a trade
 * notification), and a trade inside a DM chat waits for direct messages to
 * exist. Nothing here reads or counts trades.
 *
 * Data, each part on its own release gate:
 *   - every league you're in contributes its real message board as a group
 *     conversation (the design's "Sunday Funday League" row) — `leagues`;
 *   - direct messages come from the DM feed the desktop rail uses, empty
 *     until a DM backend exists — `messages`.
 */
export function MobileMessagesList() {
  const router = useRouter()
  const { user } = useAuth()
  const dms = useMobileMessagesDms()
  const leaguesOn = featureFlags.leagues
  const leagues = useLeagues({ enabled: leaguesOn })
  const myLeagues = leaguesOn ? (leagues.data ?? []) : []
  const leaguesLoading = leaguesOn && leagues.isPending
  const leaguesError = leaguesOn && leagues.isError && !leagues.data

  const query = useMessagesStore((s) => s.query)
  const setQuery = useMessagesStore((s) => s.setQuery)
  const markRead = useMessagesStore((s) => s.markRead)
  const setOpenedFromList = useMessagesStore((s) => s.setOpenedFromList)

  const back = () => {
    if (window.history.length > 1) router.back()
    else router.replace('/app')
  }

  const open = (threadId: string) => {
    markRead(threadId)
    setOpenedFromList(threadId)
  }

  // League boards, then direct messages.
  const people = dms.conversations
  const boards = myLeagues.map((l, i) => ({ league: l, index: i })).filter(({ league }) => matchesName(league.name, query))
  const dmRows = dms.conversations.filter((c) => matchesName(c.name, query))
  const nothing = !leaguesLoading && !leaguesError && boards.length === 0 && dmRows.length === 0

  const header = (
    <>
      <div className="flex h-[52px] items-center gap-2 px-3">
        <BackPill onClick={back} />
      </div>
      <div className="flex-none px-4 pb-2.5">
        <h1 className="pb-2.5 text-[28px] font-semibold leading-[34px] tracking-[-0.03em] text-m-t1">Messages</h1>
        <label className="flex h-[38px] items-center gap-2 rounded-[12px] bg-m-b2 px-3">
          <svg
            viewBox="0 0 16 16"
            width={15}
            height={15}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            aria-hidden
            className="flex-none text-m-t4"
          >
            <circle cx="7" cy="7" r="4.8" />
            <path d="M10.6 10.6L14 14" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search messages"
            enterKeyHint="search"
            autoComplete="off"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] font-medium text-m-t1 outline-none placeholder:text-fs-text-3"
          />
        </label>
      </div>
      {people.length > 0 && <PeopleRow people={people} onOpen={open} />}
    </>
  )

  return (
    <MobileScreen header={header}>
      <div data-conversations>
        {leaguesError && (
          <MessagesEmpty title={BOARDS_ERROR} role="alert" className="pt-6">
            <button type="button" className={EMPTY_PILL} onClick={() => void leagues.refetch()}>
              Retry
            </button>
          </MessagesEmpty>
        )}
        {leaguesLoading ? (
          <>
            <ConversationRowSkeleton />
            <ConversationRowSkeleton />
            <ConversationRowSkeleton />
          </>
        ) : (
          boards.map(({ league, index }) => (
            <LeagueBoardRow
              key={league.id}
              league={league}
              index={index}
              viewerId={user?.id ?? null}
              onOpen={(id) => setOpenedFromList(id)}
            />
          ))
        )}
        {dmRows.map((c) => (
          <DmRow key={c.id} conversation={c} onOpen={open} />
        ))}
        {nothing &&
          (query ? (
            <MessagesEmpty title={`No conversations match “${query}”`} />
          ) : (
            <MessagesEmpty title={MESSAGES_EMPTY_TITLE} body={messagesEmptyBody(leaguesOn, dms.enabled)} />
          ))}
      </div>
    </MobileScreen>
  )
}

/** A direct-message conversation row (DM feed). */
function DmRow({ conversation: c, onOpen }: { conversation: MDmConversation; onOpen: (id: string) => void }) {
  return (
    <ConversationRow
      href={threadHref(c.id)}
      onOpen={() => onOpen(c.id)}
      name={c.name}
      unread={c.unread}
      preview={c.preview ? previewLine(c.preview, c.time) : ''}
      avatar={
        <MessagesAvatar
          text={c.initial}
          src={c.avatarUrl}
          sizeClass="size-[52px]"
          colorClass={c.colorClass}
          textClass="text-[16px]"
        />
      }
    />
  )
}

/**
 * The horizontal people row (§2.1 C): one 58px item per direct
 * conversation, 52px avatar and an 11px name. Not filtered by the search.
 */
function PeopleRow({ people, onOpen }: { people: readonly MDmConversation[]; onOpen: (id: string) => void }) {
  return (
    <div className="scrollbar-none flex flex-none gap-3.5 overflow-x-auto px-4 pb-3 pt-1" data-people-row>
      {people.map((p) => (
        <Link
          key={p.id}
          href={threadHref(p.id)}
          onClick={() => onOpen(p.id)}
          className="flex w-[58px] flex-none flex-col items-center gap-[5px]"
        >
          <MessagesAvatar
            text={p.initial}
            src={p.avatarUrl}
            sizeClass="size-[52px]"
            colorClass={p.colorClass}
            textClass="text-[17px]"
          />
          <span className="max-w-[58px] truncate text-[11px] font-medium text-m-t2">{p.name}</span>
        </Link>
      ))}
    </div>
  )
}
