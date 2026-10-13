'use client'

import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/ui/user-avatar'
import { UsernameLink } from '@/components/shared/username-link'
import type { LeagueDetail } from '@/hooks/use-league'
import { useLeagueChat, useSendLeagueChat } from '@/hooks/use-league-chat'

import { formatInstantWithDate } from './lineup-editor-ops'

export const MESSAGE_BOARD_EMPTY_COPY = 'No messages yet — say something to the league.'
export const MESSAGE_BOARD_ERROR_COPY = 'Couldn’t load the message board.'
export const FORMER_MEMBER_LABEL = 'Former member'
const MAX_MESSAGE = 500
export const POST_NOT_MEMBER_COPY = 'You’re no longer a member of this league.'
export const POST_FAILED_COPY = 'Couldn’t post — try again.'

/** R1476: never show a raw database error — an RLS refusal reads as lost
 *  membership, anything else as a plain retry. */
export function postErrorCopy(error: unknown): string {
  const msg = error instanceof Error ? error.message : ''
  if (/row-level security|permission denied|42501/i.test(msg)) return POST_NOT_MEMBER_COPY
  return POST_FAILED_COPY
}

/**
 * League Home's "Message board" card (League UX batch 4, D479) — the
 * prototype's HomeTab board over the league's own chat (`league_chat`,
 * `context = 'league'`). Author names are `UsernameLink`s (Chris
 * 2026-09-30). Non-interactive card: no resting or hover shadow.
 */
export function LeagueMessageBoard({ leagueId, data, viewerId }: { leagueId: string; data: LeagueDetail; viewerId: string | null }) {
  const chat = useLeagueChat(leagueId)
  const send = useSendLeagueChat(leagueId, viewerId)
  const [draft, setDraft] = useState('')
  const members = new Map(data.members.filter((m) => m.user_id).map((m) => [m.user_id as string, m.profiles]))
  const tz = data.settings.draft.time_zone ?? null
  const isMember = viewerId !== null && members.has(viewerId)
  const rows = chat.data ?? []

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || send.isPending) return
    send.mutate(text, { onSuccess: () => setDraft('') })
  }

  return (
    // v7's League Home "Message board": a bare section (15px title) over
    // grouped posts — round 24px author avatars, 11px name, 10px grey time,
    // 11px body — and the composer as one v7 field with a round send button.
    // Non-interactive surface: no resting or hover shadow.
    <div className="flex min-w-0 flex-col gap-2.5" data-message-board>
      <div className="flex items-center gap-2">
        <span className="text-h6 text-ink">Message board</span>
      </div>
      <div className="flex flex-col gap-3">
        {chat.isPending ? (
          <div className="flex flex-col gap-2" data-skeleton="message-board">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-8 rounded-md" />
            ))}
          </div>
        ) : chat.isError && !chat.data ? (
          <div className="flex flex-col items-start gap-2 rounded-xl bg-negative-soft px-3.5 py-3" role="alert" data-problem>
            <p className="text-[12px] font-bold text-ink">{MESSAGE_BOARD_ERROR_COPY}</p>
            <Button variant="stroke" size="sm" onClick={() => chat.refetch()}>
              <Icon name="reset" size={13} /> Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-xl bg-surface-sunken px-3.5 py-4 text-center text-[11px] font-medium text-n-6" data-empty="message-board">
            {MESSAGE_BOARD_EMPTY_COPY}
          </p>
        ) : (
          <ol className="flex max-h-80 flex-col gap-3 overflow-y-auto" data-message-rows>
            {rows.map((row) => {
              const profile = row.user_id ? members.get(row.user_id) ?? null : null
              const when = row.created_at ? formatInstantWithDate(row.created_at, tz) : null
              return (
                <li key={row.id} className="flex items-start gap-[9px]" data-message={row.id}>
                  <UserAvatar src={profile?.avatar_url ?? null} name={profile?.username ?? null} className="h-6 w-6 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="flex min-w-0 flex-wrap items-baseline gap-[5px] text-[11px] font-bold text-ink">
                      {profile?.username ? <UsernameLink username={profile.username} /> : <span className="text-n-6">{FORMER_MEMBER_LABEL}</span>}
                      {when && (
                        <span className="fs-num text-[10px] font-medium text-n-6" title={when.title ?? undefined}>
                          {when.local}
                        </span>
                      )}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-[11px] font-medium leading-[1.45] text-n-2">{row.message}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        {isMember && (
          <form
            onSubmit={onSubmit}
            className="flex h-[34px] items-center gap-[7px] rounded-lg bg-white pl-1 pr-[5px] shadow-ring-chip transition-shadow focus-within:shadow-field"
            data-message-composer
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message the league…"
              maxLength={MAX_MESSAGE}
              aria-label="Message the league"
              className="h-7 min-w-0 flex-1 bg-transparent px-2 hover:bg-transparent focus:bg-transparent focus:shadow-none"
            />
            <Button
              type="submit"
              variant="blue"
              size="icon-sm"
              className="rounded-full"
              disabled={!draft.trim() || send.isPending}
              aria-label="Post"
              data-message-send
            >
              <Icon name="send" size={11} />
            </Button>
          </form>
        )}
        {send.isError && (
          <p role="alert" className="text-[11px] font-semibold text-negative-strong">
            {postErrorCopy(send.error)}
          </p>
        )}
      </div>
    </div>
  )
}
