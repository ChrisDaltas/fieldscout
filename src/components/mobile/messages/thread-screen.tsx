'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

import { postErrorCopy } from '@/components/leagues/league-message-board'
import { teamAvClass, teamOrder } from '@/components/mobile/league/team/team-ops'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { initials, leagueAvClass } from '@/components/mobile/shell/use-league-card'
import { UsernameLink } from '@/components/shared/username-link'
import { useAuth } from '@/hooks/use-auth'
import { useLeague } from '@/hooks/use-league'
import { useLeagueChat, useSendLeagueChat } from '@/hooks/use-league-chat'
import { useLeagues } from '@/hooks/use-leagues'
import { useMobileMessagesDms } from '@/hooks/use-mobile-messages-dms'
import { useMobileMessagesPinBottom } from '@/hooks/use-mobile-messages-pin-bottom'
import { toast } from '@/hooks/use-toast'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'

import { MessagesAvatar } from './messages-avatar'
import { EMPTY_PILL, MessagesEmpty } from './messages-empty'
import {
  FORMER_MEMBER,
  MY_COLOR,
  bubbleRadius,
  senderHandle,
  initialOf,
  lastMessageOf,
  leagueIdOfThread,
  membersLine,
  seatColor,
  threadItems,
  type MChatMessage,
  type ThreadItem,
} from './messages-ops'
import { useMessagesStore } from './messages-store'

export const THREAD_MISSING_TITLE = 'Conversation not found'
export const THREAD_MISSING_BODY = 'It may have been removed, or it isn’t one of yours.'
export const THREAD_ERROR_TITLE = 'Couldn’t load this conversation.'
export const BOARD_EMPTY_TITLE = 'No messages yet'
export const BOARD_EMPTY_BODY = 'Say something to the league.'
/** The league board's post limit (065's 1..500 chars). */
const MAX_MESSAGE = 500

/**
 * FieldScout Mobile — a conversation (m-messages §2.2, S3). A league's
 * message board is the group thread (S3b: rounded-square mark, "N members",
 * sender names over their runs); a direct message is the 1:1 thread (S3a).
 * Each on its own release gate: the boards are the leagues' (`leagues`),
 * direct messages the DM feed's (`messages`).
 *
 * It opens at the NEWEST message and follows new ones as they arrive,
 * unless the reader has scrolled up to read (Chris, #47, 2026-10-15 — the
 * design opened at the oldest; `useMobileMessagesPinBottom`).
 * There is no info (i) or "+" button: the design gives them no flow (it
 * only toasts "Not part of this prototype").
 */
export function MobileThreadScreen({ threadId }: { threadId: string }) {
  const leagueId = leagueIdOfThread(threadId)
  if (leagueId) {
    return featureFlags.leagues ? <LeagueBoardThread leagueId={leagueId} /> : <ThreadMissing />
  }
  return featureFlags.messages ? <DmThread threadId={threadId} /> : <ThreadMissing />
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Back goes to where you came from (Chris, #27, 2026-10-15: "Back always
 * goes to where you came from. Period.") — the Messages list, a league page,
 * a notification — by history; only with nothing of the app's behind (a
 * shared link opened fresh) does it replace this entry with the list.
 */
function useThreadBack() {
  const goBack = useGoBack()
  return () => goBack('/app/messages')
}

// ---------------------------------------------------------------------------
// Group thread — a league's message board
// ---------------------------------------------------------------------------

function LeagueBoardThread({ leagueId }: { leagueId: string }) {
  const back = useThreadBack()
  const { user } = useAuth()
  const viewerId = user?.id ?? null
  const leagues = useLeagues()
  const detail = useLeague(leagueId)
  const chat = useLeagueChat(leagueId)
  const send = useSendLeagueChat(leagueId, viewerId)
  const [draft, setDraft] = useState('')

  const index = Math.max(0, leagues.data?.findIndex((l) => l.id === leagueId) ?? 0)
  const name = detail.data?.league.name ?? leagues.data?.find((l) => l.id === leagueId)?.name ?? ''

  // Members by user id, with their avatar colour: their team's colour (the
  // one the Team view and the trade screens give it), else a seat colour.
  const people = useMemo(() => {
    const map = new Map<string, { username: string | null; avatarUrl: string | null; colorClass: string }>()
    const order = teamOrder(detail.data?.teams ?? [])
    const myTeam = detail.data?.members.find((m) => m.user_id === viewerId)?.team_id ?? null
    detail.data?.members.forEach((m, i) => {
      if (!m.user_id) return
      map.set(m.user_id, {
        username: m.profiles?.username ?? null,
        avatarUrl: m.profiles?.avatar_url ?? null,
        colorClass: m.team_id && order.includes(m.team_id) ? teamAvClass(m.team_id, order, myTeam) : seatColor(i),
      })
    })
    return map
  }, [detail.data, viewerId])

  const messages = useMemo(
    () =>
      (chat.data ?? []).map((row): MChatMessage => {
        const fromMe = viewerId !== null && row.user_id === viewerId
        const who = row.user_id ? people.get(row.user_id) : undefined
        return {
          id: row.id,
          fromMe,
          senderKey: row.user_id ?? 'former',
          senderName: fromMe ? 'You' : row.user_id && who ? senderHandle(who.username) : FORMER_MEMBER,
          senderUsername: who?.username ?? null,
          senderAvatarUrl: who?.avatarUrl ?? null,
          senderColorClass: fromMe ? MY_COLOR : who ? who.colorClass : 'bg-m-t5',
          text: row.message,
          at: row.created_at,
        }
      }),
    [chat.data, people, viewerId],
  )

  const ready = !chat.isPending && !detail.isPending
  const isMember = viewerId !== null && people.has(viewerId)

  const submit = () => {
    const text = draft.trim()
    if (!text || send.isPending) return
    send.mutate(text, {
      onSuccess: () => setDraft(''),
      onError: (error) => toast({ title: postErrorCopy(error) }),
    })
  }

  const header = (
    <ThreadHeader
      onBack={back}
      name={name}
      sub={detail.data ? membersLine(people.size) : ''}
      avatar={
        <MessagesAvatar
          text={name ? initials(name) : ''}
          sizeClass="size-9"
          radiusClass="rounded-[11px]"
          colorClass={leagueAvClass(index)}
          fgClass="text-inherit"
          textClass="text-[13px]"
        />
      }
    />
  )

  let body: React.ReactNode
  if (detail.isError && !detail.data) {
    body = (
      <MessagesEmpty title={THREAD_ERROR_TITLE} role="alert">
        <button type="button" className={EMPTY_PILL} onClick={() => void detail.refetch()}>
          Retry
        </button>
        <GoBackPill onBack={back} />
      </MessagesEmpty>
    )
  } else if (!ready) {
    body = <BubblesSkeleton />
  } else if (chat.isError && !chat.data) {
    body = (
      <MessagesEmpty title={THREAD_ERROR_TITLE} role="alert">
        <button type="button" className={EMPTY_PILL} onClick={() => void chat.refetch()}>
          Retry
        </button>
      </MessagesEmpty>
    )
  } else if (messages.length === 0) {
    body = <MessagesEmpty title={BOARD_EMPTY_TITLE} body={isMember ? BOARD_EMPTY_BODY : undefined} />
  } else {
    body = <MessageList items={threadItems(messages, true)} group />
  }

  return (
    <ThreadFrame header={header}>
      {body}
      {isMember && <Composer value={draft} onChange={setDraft} onSend={submit} sending={send.isPending} />}
    </ThreadFrame>
  )
}

// ---------------------------------------------------------------------------
// 1:1 thread — the DM feed (empty until a DM backend exists)
// ---------------------------------------------------------------------------

function DmThread({ threadId }: { threadId: string }) {
  const dms = useMobileMessagesDms()
  const c = dms.conversations.find((x) => x.id === threadId) ?? null
  const markRead = useMessagesStore((s) => s.markRead)
  const addSent = useMessagesStore((s) => s.addSent)
  const [draft, setDraft] = useState('')
  const back = useThreadBack()

  const openId = c?.id ?? null
  useEffect(() => {
    if (openId) markRead(openId)
  }, [openId, markRead])

  if (!c) return <ThreadMissing />

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    // Local only, as the desktop rail's composer — there is no DM backend.
    addSent(c.id, text)
    setDraft('')
  }

  return (
    <ThreadFrame
      header={
        <ThreadHeader
          onBack={back}
          name={c.name}
          sub={c.teamName}
          avatar={
            <MessagesAvatar
              text={c.initial}
              src={c.avatarUrl}
              sizeClass="size-9"
              colorClass={c.colorClass}
              textClass="text-[13px]"
            />
          }
        />
      }
    >
      <MessageList items={threadItems(c.messages, false)} group={false} />
      <Composer value={draft} onChange={setDraft} onSend={submit} sending={false} />
    </ThreadFrame>
  )
}

function ThreadMissing() {
  const back = useThreadBack()
  return (
    <ThreadFrame header={<ThreadHeader onBack={back} name="" sub="" avatar={null} />}>
      <MessagesEmpty title={THREAD_MISSING_TITLE} body={THREAD_MISSING_BODY}>
        <GoBackPill onBack={back} />
      </MessagesEmpty>
    </ThreadFrame>
  )
}

/**
 * A dead or unreadable thread's way out: the header's own Back (#27), never
 * a push to the list — a push would leave the dead thread behind it, so the
 * list's Back would land on it again. It may lead somewhere other than
 * Messages (a notification, a league page), so it says "Go back".
 */
function GoBackPill({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className={EMPTY_PILL} onClick={onBack} data-thread-go-back>
      Go back
    </button>
  )
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

/**
 * The thread screen: sticky header, the messages in page flow, and the
 * composer pinned just above the dock. The prototype's tab bar covered the
 * composer (§2.2 C) — a defect; here it always sits clear of it.
 */
function ThreadFrame({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  return (
    <MobileScreen header={header}>
      <div className="flex min-h-[calc(100vh-var(--m-dockpad)-56px-env(safe-area-inset-top))] flex-col" data-thread>
        {children}
      </div>
    </MobileScreen>
  )
}

/** §2.2 A — back circle, avatar, name + sub-line. (The design's info
 *  button has no flow — left out.) */
function ThreadHeader({
  onBack,
  avatar,
  name,
  sub,
}: {
  onBack: () => void
  avatar: React.ReactNode
  name: string
  sub: string
}) {
  return (
    <div className="flex h-14 items-center gap-2.5 border-b border-m-b3 px-3 text-m-t1">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="flex size-9 flex-none items-center justify-center rounded-full text-accent active:bg-m-b2"
      >
        <MIcon name="back" size={20} stroke={2} />
      </button>
      {avatar}
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        {name && <h1 className="truncate text-[15px] font-semibold">{name}</h1>}
        {sub && <span className="text-[11.5px] font-medium text-m-t3">{sub}</span>}
      </div>
    </div>
  )
}

/** §2.2 B — day separators, runs of bubbles, avatars on their last bubble.
 *  Opens at the newest and follows new ones while the reader is there (#47). */
function MessageList({ items, group }: { items: ThreadItem[]; group: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const last = useMemo(() => lastMessageOf(items), [items])
  useMobileMessagesPinBottom(ref, last)
  return (
    <div ref={ref} className="flex flex-1 flex-col gap-1 px-3 py-4" role="log" aria-label="Messages" data-message-list={group ? 'group' : 'direct'}>
      {items.map((item, i) =>
        item.kind === 'day' ? (
          <span key={item.key} className={cn('self-center pb-2 text-[11px] font-medium text-m-t3', i > 0 && 'mt-2')}>
            {item.label}
          </span>
        ) : (
          <MessageRow key={item.key} item={item} />
        ),
      )}
    </div>
  )
}

function MessageRow({ item }: { item: Extract<ThreadItem, { kind: 'msg' }> }) {
  const m = item.message
  return (
    <div
      className={cn('flex items-end gap-1.5', m.fromMe ? 'justify-end' : 'justify-start', item.gapTop && 'mt-2')}
      data-message={m.id}
      data-from={m.fromMe ? 'me' : 'them'}
    >
      {item.showAvatar && (
        <MessagesAvatar
          text={initialOf(m.senderName)}
          src={m.senderAvatarUrl}
          sizeClass="size-[26px]"
          colorClass={m.senderColorClass}
          textClass="text-[10px]"
        />
      )}
      {item.spacer && <span className="w-[26px] flex-none" aria-hidden />}
      <div className={cn('flex max-w-[74%] flex-col gap-0.5', m.fromMe ? 'items-end' : 'items-start')}>
        {item.showName && (
          <span className="px-2.5 text-[11px] font-medium text-m-t3">
            {m.senderUsername ? <UsernameLink username={m.senderUsername} /> : m.senderName}
          </span>
        )}
        <div
          className={cn(
            'whitespace-pre-wrap break-words px-[13px] py-[9px] text-[15px] font-medium leading-[1.35] text-pretty',
            bubbleRadius(m.fromMe, item.lastOfRun),
            m.fromMe ? 'bg-accent text-white' : 'bg-m-b2 text-m-t1',
          )}
        >
          {m.fromMe ? <span className="sr-only">You: </span> : !item.showName ? <span className="sr-only">{m.senderName}: </span> : null}
          {m.text}
        </div>
      </div>
    </div>
  )
}

/**
 * §2.2 C — the "Message" pill and the Send pill (only while there is text).
 * Enter sends, except while an IME is composing. (The design's "+" has no
 * flow — left out.)
 */
function Composer({
  value,
  onChange,
  onSend,
  sending,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  sending: boolean
}) {
  const hasMsg = value.trim() !== ''
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    onSend()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault()
  }
  return (
    <form
      onSubmit={onSubmit}
      className="sticky bottom-[var(--m-dockpad)] z-[1] mt-auto flex flex-none items-center gap-2 border-t border-m-b3 bg-m-b0 px-3 pb-2.5 pt-2"
      data-composer
    >
      <div className="flex h-10 min-w-0 flex-1 items-center rounded-pill pl-3.5 pr-1.5 ring-1 ring-inset ring-m-b3s">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message"
          aria-label="Message"
          maxLength={MAX_MESSAGE}
          enterKeyHint="send"
          autoComplete="off"
          className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] font-medium text-m-t1 outline-none placeholder:text-fs-text-3"
        />
        {hasMsg && (
          <button
            type="submit"
            disabled={sending}
            className="flex h-[30px] flex-none items-center rounded-pill bg-accent px-3 text-[13px] font-semibold text-white"
          >
            Send
          </button>
        )}
      </div>
    </form>
  )
}

/** Loading: a few bubble shapes on b1, alternating sides. */
function BubblesSkeleton() {
  const widths = ['w-[62%]', 'w-[48%]', 'w-[56%]', 'w-[40%]']
  return (
    <div className="flex flex-1 flex-col gap-2 px-3 py-4" aria-hidden data-skeleton="thread">
      {widths.map((w, i) => (
        <span key={w} className={cn('h-[38px] rounded-[18px] bg-m-b1', w, i % 2 === 1 && 'self-end')} />
      ))}
    </div>
  )
}
