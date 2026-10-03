'use client'

import { useState, type FormEvent } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
    <Card data-message-board>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="flex items-center gap-2 text-[12px]">
          Message board
          {rows.length > 0 && (
            <Badge variant="stroke" className="ml-auto" data-message-count>
              <span className="fs-num">{rows.length}</span>
              {rows.length === 1 ? ' message' : ' messages'}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-card-pad py-3">
        {chat.isPending ? (
          <div className="flex flex-col gap-2" data-skeleton="message-board">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-8 rounded-sm" />
            ))}
          </div>
        ) : chat.isError && !chat.data ? (
          <div className="flex flex-col items-start gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2" role="alert" data-problem>
            <p className="text-[12px] font-bold">{MESSAGE_BOARD_ERROR_COPY}</p>
            <Button variant="stroke" size="sm" onClick={() => chat.refetch()}>
              <Icon name="reset" size={13} /> Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-[12px] font-medium text-n-3" data-empty="message-board">
            {MESSAGE_BOARD_EMPTY_COPY}
          </p>
        ) : (
          <ol className="flex max-h-80 flex-col gap-3 overflow-y-auto" data-message-rows>
            {rows.map((row) => {
              const profile = row.user_id ? members.get(row.user_id) ?? null : null
              const when = row.created_at ? formatInstantWithDate(row.created_at, tz) : null
              return (
                <li key={row.id} className="flex items-start gap-2" data-message={row.id}>
                  <UserAvatar src={profile?.avatar_url ?? null} name={profile?.username ?? null} className="h-6 w-6 shrink-0" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-1.5 text-[11px] font-bold">
                      {profile?.username ? <UsernameLink username={profile.username} /> : <span className="text-n-3">{FORMER_MEMBER_LABEL}</span>}
                      {when && (
                        <span className="fs-num font-semibold text-n-3" title={when.title ?? undefined}>
                          {when.local}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] font-medium leading-snug text-ink">{row.message}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        {isMember && (
          <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-n-4 pt-3" data-message-composer>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message the league…"
              maxLength={MAX_MESSAGE}
              aria-label="Message the league"
              className="h-8 flex-1 text-[12px]"
            />
            <Button type="submit" variant="blue" size="sm" disabled={!draft.trim() || send.isPending} aria-label="Post" data-message-send>
              <Icon name="send" size={13} />
            </Button>
          </form>
        )}
        {send.isError && (
          <p role="alert" className="text-[11px] font-semibold text-negative">
            Couldn’t post that — {send.error instanceof Error ? send.error.message : 'try again'}.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
