'use client'

import Link from 'next/link'

import { initials, leagueAvClass } from '@/components/mobile/shell/use-league-card'
import { useLeague } from '@/hooks/use-league'
import { useLeagueChat } from '@/hooks/use-league-chat'
import type { MyLeagueRow } from '@/hooks/use-leagues'
import { cn } from '@/lib/utils'

import { MessagesAvatar } from './messages-avatar'
import {
  FORMER_MEMBER,
  senderHandle,
  leagueThreadId,
  previewLine,
  previewText,
  shortTime,
  threadHref,
} from './messages-ops'

/**
 * One 72px conversation row (§2.1 E): 52px avatar (16px radius for a group,
 * round for a person), name 15px (600 when unread), preview 13px
 * "{preview} · {time}" (600 t1 when unread, else 500 t3), the 10px blue
 * unread dot. No dividers; pressed b1.
 */
export function ConversationRow({
  href,
  onOpen,
  name,
  avatar,
  preview,
  unread = false,
  loading = false,
}: {
  href: string
  onOpen?: () => void
  name: string
  avatar: React.ReactNode
  /** The whole second line, time included. */
  preview: string
  unread?: boolean
  loading?: boolean
}) {
  return (
    <Link
      href={href}
      onClick={onOpen}
      className="flex h-[72px] items-center gap-3 px-4 text-m-t1 active:bg-m-b1"
      data-conversation-row
    >
      {avatar}
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className={cn('truncate text-[15px] leading-[19px]', unread ? 'font-semibold' : 'font-medium')}>{name}</span>
        {loading ? (
          <span className="h-4 w-2/3 rounded-[6px] bg-m-b1" aria-hidden data-skeleton="preview" />
        ) : (
          <span
            className={cn(
              'truncate text-[13px] leading-4',
              unread ? 'font-semibold text-m-t1' : 'font-medium text-m-t3',
            )}
          >
            {preview}
          </span>
        )}
      </span>
      {unread && (
        <>
          <span className="size-2.5 flex-none rounded-full bg-accent" aria-hidden data-unread-dot />
          <span className="sr-only">Unread</span>
        </>
      )}
    </Link>
  )
}

/** A loading row: the 72px row's shapes on b1. */
export function ConversationRowSkeleton() {
  return (
    <div className="flex h-[72px] items-center gap-3 px-4" aria-hidden data-skeleton="conversation">
      <span className="size-[52px] flex-none rounded-full bg-m-b1" />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="h-3.5 w-1/3 rounded-[6px] bg-m-b1" />
        <span className="h-3 w-2/3 rounded-[6px] bg-m-b1" />
      </span>
    </div>
  )
}

export const BOARD_EMPTY_PREVIEW = 'No messages yet'
export const BOARD_ERROR_PREVIEW = 'Couldn’t load messages'

/**
 * Who signed a board post, for the row's "{Sender}: " prefix: the member's
 * name; "Former member" when the members list is read and they're not on
 * it (as the desktop board says); null when the members list couldn't be
 * read — then the row names nobody rather than calling a current member
 * gone.
 */
export function boardSender(
  userId: string | null,
  members: ReadonlyArray<{ user_id: string | null; profiles: { username: string } | null }> | null,
): string | null {
  if (!userId) return FORMER_MEMBER
  if (!members) return null
  const member = members.find((m) => m.user_id === userId)
  return member ? senderHandle(member.profiles?.username) : FORMER_MEMBER
}

/**
 * A league's message board as the group conversation ("Sunday Funday
 * League" in the design): the league mark, the latest post as
 * "{Sender}: {text} · {time}". Real data — `league_chat` (context
 * 'league') over the league channel. Never bold, no unread dot: the board
 * has no per-member read marker (a gap).
 */
export function LeagueBoardRow({
  league,
  index,
  viewerId,
  onOpen,
}: {
  league: MyLeagueRow
  /** The league's place in your list — its mark colour (as the dock). */
  index: number
  viewerId: string | null
  onOpen: (threadId: string) => void
}) {
  const chat = useLeagueChat(league.id)
  const detail = useLeague(league.id)
  const rows = chat.data ?? []
  const last = rows[rows.length - 1]
  const id = leagueThreadId(league.id)

  // The sender's name needs the member list; wait for it rather than
  // flashing "Former member".
  const loading = chat.isPending || (last?.user_id != null && detail.isPending)
  let preview: string
  if (chat.isError && !chat.data) preview = BOARD_ERROR_PREVIEW
  else if (!last) preview = BOARD_EMPTY_PREVIEW
  else {
    const fromMe = viewerId !== null && last.user_id === viewerId
    const sender = fromMe ? 'You' : boardSender(last.user_id, detail.data?.members ?? null)
    preview = previewLine(
      sender === null ? last.message : previewText({ fromMe, senderName: sender, text: last.message }, true),
      last.created_at ? shortTime(last.created_at) : null,
    )
  }

  return (
    <ConversationRow
      href={threadHref(id)}
      onOpen={() => onOpen(id)}
      name={league.name}
      loading={loading}
      preview={preview}
      avatar={
        <MessagesAvatar
          text={initials(league.name)}
          sizeClass="size-[52px]"
          radiusClass="rounded-[16px]"
          colorClass={leagueAvClass(index)}
          fgClass="text-inherit"
          textClass="text-[16px]"
        />
      }
    />
  )
}
