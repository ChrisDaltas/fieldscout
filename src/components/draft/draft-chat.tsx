'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { TextWithActor, UsernameLink } from '@/components/shared/username-link'
import { useDraftChat, useSendDraftChat } from '@/hooks/use-draft-chat'
import {
  CHAT_MAX_LENGTH,
  chatAuthorsById,
  chatDraftSendable,
  chatItemView,
  type ChatItemView,
} from '@/hooks/use-draft-chat-ops'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import type { RoomScope } from './room-scope'

interface DraftChatProps {
  /** The room's context object (MP.6c). `scope.leagueId === null` is a
   *  STANDALONE practice room: the feed renders, the composer does not. */
  scope: RoomScope
  draftId: string
  userId: string | null
  className?: string
}

/**
 * Draft chat (§16.2 `draft-chat`; §8.8; M2 task L.B3.3). Sends are the ONE
 * spec-sanctioned direct client INSERT (D99 — no chat route exists on
 * purpose); the live feed rides the room's existing `draft:<id>` channel
 * (`useDraftRoom` folds `league_chat` broadcasts into this pane's query).
 *
 * SYSTEM POSTS (§16.3 — "every commish action shows the live system post in
 * chat so the room sees it happen"): distinct treatment, NON-HIDEABLE by
 * construction — no filter/mute affordance exists here, deliberately.
 * Render shapes incl. BOTH authorless arms are the pure `chatItemView`
 * (D108(15)): system rows actorless by shape; ordinary `user_id`-NULL rows
 * (a deleted account's messages — R137) as the former-member fallback.
 *
 * **STANDALONE PRACTICE (MP.6c / ledger F114): the FEED is the point and the
 * COMPOSER is not there.** The engine's own D97 system posts — auto-paused,
 * resumed, the clock notices — are written for a league-less mock too (095,
 * with a NULL `league_id`), and until F114 the pane never asked for them.
 * They render here. The SEND side stays where D226(2) left it: a mock has
 * one human and eleven bots, so there is nobody to message — the input is
 * not disabled-with-a-reason, it is absent, because a control that could
 * never do anything is not a control (§16.3's one-voice rule, and §4 rule
 * 16 forbids explaining the absence).
 */
export function DraftChat({ scope, draftId, userId, className }: DraftChatProps) {
  const standalone = scope.leagueId === null
  const chat = useDraftChat(draftId)
  // The league id, or NULL — never a placeholder `''` (R534). Sending is
  // league-only (D226(2)) and the composer below is absent standalone, so
  // this mutation is unfireable there; the hook refuses a null league rather
  // than being handed a blank that looks like an id.
  const send = useSendDraftChat(scope.leagueId, draftId, userId)
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  const authors = useMemo(
    () => chatAuthorsById(scope.members, scope.teams),
    [scope.members, scope.teams],
  )
  // L.E1.41: user id → username, so an author's (or a post's actor's) name
  // opens his profile — in a new tab, so the room is never left mid-draft.
  const usernames = useMemo(
    () =>
      new Map(
        scope.members.flatMap((m): Array<[string, string]> => (m.user_id && m.profiles ? [[m.user_id, m.profiles.username]] : [])),
      ),
    [scope.members],
  )
  const items = useMemo(
    () => (chat.data ?? []).map((row) => ({ id: row.id, view: chatItemView(row, authors, userId, usernames) })),
    [chat.data, authors, userId, usernames],
  )

  // Follow the newest message (the room's live transparency loop — a system
  // post landing must be SEEN, §16.3).
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items.length])

  const sendable = chatDraftSendable(text) && Boolean(userId) && !send.isPending
  const handleSend = () => {
    if (!sendable) return
    const message = text
    setText('')
    send.mutateAsync(message).catch((error: unknown) => {
      setText(message) // give the draft back — nothing was posted
      toast({
        title: 'Message not sent',
        description:
          error instanceof Error && error.message
            ? error.message
            : 'Something went wrong. Try again.',
        variant: 'destructive',
      })
    })
  }

  return (
    <Card className={cn('flex min-h-0 flex-col', className)}>
      <CardHeader>
        <span className="text-[13px] font-extrabold">Draft chat</span>
        {/* Bounded-window honesty: the pane holds the recent scroll, not the
            whole history — no count rendered, nothing to over-claim. */}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-col gap-2.5">
        <div
          ref={listRef}
          className="flex max-h-72 min-h-[96px] flex-col gap-1.5 overflow-y-auto pr-0.5"
          role="log"
          aria-label="Draft chat messages"
        >
          {chat.isPending && (
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-8 rounded-sm" />
              <Skeleton className="h-8 rounded-sm" />
            </div>
          )}
          {chat.isError && (
            <div className="flex flex-col items-start gap-1.5">
              <p className="text-[12px] font-medium text-n-3">Chat didn’t load.</p>
              <Button variant="stroke" size="sm" onClick={() => void chat.refetch()}>
                <Icon name="reset" size={13} /> Retry
              </Button>
            </div>
          )}
          {chat.isSuccess && items.length === 0 && (
            <p className="text-[12px] font-medium text-n-3">
              {standalone
                ? // Nobody to hear you: the seats are CPUs (D226(2)). What
                  // lands here is the engine's own notices.
                  'No messages yet.'
                : 'No messages yet — the room can hear you.'}
            </p>
          )}
          {items.map(({ id, view }) => (
            <ChatItem key={id} view={view} />
          ))}
        </div>

        {!standalone && (
          <div className="flex items-center gap-1.5">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              maxLength={CHAT_MAX_LENGTH}
              placeholder={userId ? 'Message the room…' : 'Sign in to chat'}
              disabled={!userId || send.isPending}
              aria-label="Chat message"
              className="h-btn-md text-[12px]"
            />
            <Button
              variant="blue"
              size="sm"
              onClick={handleSend}
              disabled={!sendable}
              aria-label="Send message"
            >
              <Icon name="send" size={13} />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function ChatItem({ view }: { view: ChatItemView }) {
  if (view.kind === 'system') {
    // §16.3: system posts are DISTINCT (accent treatment) and non-hideable —
    // the actor is named in the message text itself (D108(15): actorless by
    // shape; the tick's posts carry user_id NULL and render identically).
    return (
      <p className="rounded-sm border-l-2 border-accent bg-accent-soft px-2 py-1 text-[12px] font-semibold text-ink">
        <TextWithActor text={view.message} actor={view.username} newTab />
      </p>
    )
  }
  return (
    <div className="flex min-w-0 flex-col">
      <span
        className={cn(
          'fs-overline truncate text-[9px]',
          view.kind === 'former-member' ? 'italic text-n-3' : 'text-n-3',
          view.mine && 'text-accent-strong',
        )}
      >
        <ChatAuthor label={view.authorLabel} username={view.username} />
        {view.mine ? ' (You)' : ''}
      </span>
      <p className="whitespace-pre-wrap break-words text-[12px] font-medium text-ink">
        {view.message}
      </p>
    </div>
  )
}

/** "Team — @username" with the handle a door to his profile (new tab — the
 *  room is never left mid-draft). A label without the handle stays plain. */
function ChatAuthor({ label, username }: { label: string | null; username: string | null }) {
  const handle = username ? `@${username}` : null
  if (!label || !handle || !label.endsWith(handle)) return <>{label}</>
  return (
    <>
      {label.slice(0, label.length - handle.length)}
      <UsernameLink username={username as string} newTab />
    </>
  )
}
