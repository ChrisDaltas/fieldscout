'use client'

import { useMemo, useState } from 'react'

import { RailPanelShell } from '@/components/layout/rail/rail-panel-shell'
import { Badge, FilterChip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { UserAvatar } from '@/components/ui/user-avatar'
import { cn } from '@/lib/utils'

/** Shapes the panel expects once real league DMs exist. */
export interface RailDmMessage {
  id: string
  text: string
  fromMe: boolean
  time: string
}

export interface RailTradeProposal {
  give: string[]
  get: string[]
}

export interface RailDmThread {
  id: string
  gmName: string
  gmAvatarUrl: string | null
  teamName: string
  leagueName: string
  lastActive: string
  unread: number
  messages: RailDmMessage[]
  trade?: RailTradeProposal
}

/**
 * Sum of unread DMs — drives the unread badge on the rail strip. League DMs
 * have no backend yet, so there are no real threads in M1: this is 0 until
 * the messages API feeds real threads through the `threads` prop.
 */
export function dmUnreadCount(threads: RailDmThread[] = []): number {
  return threads.reduce((sum, t) => sum + t.unread, 0)
}

function TradeCard({ trade }: { trade: RailTradeProposal }) {
  const [status, setStatus] = useState<'Accepted' | 'Declined' | null>(null)
  // TODO(live-draft): wire accept/decline to the real trade endpoint.
  return (
    <div className="mt-1 overflow-hidden rounded-lg bg-white shadow-ring-chip">
      <div className="flex items-center gap-1.5 border-b border-n-4 bg-surface-sunken px-2.5 py-[7px]">
        <Icon name="transfer" size={12} className="text-accent" />
        <span className="text-[10px] font-bold text-n-2">Trade proposal</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 px-2.5 py-2">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[9px] font-semibold text-n-6">You give</p>
          {trade.give.map((name) => (
            <p key={name} className="truncate text-[11px] font-semibold text-ink">
              {name}
            </p>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[9px] font-semibold text-n-6">You get</p>
          {trade.get.map((name) => (
            <p key={name} className="truncate text-[11px] font-semibold text-ink">
              {name}
            </p>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-[5px] px-2.5 pb-2.5">
        {status ? (
          <Badge variant={status === 'Accepted' ? 'green' : 'stroke'}>{status}</Badge>
        ) : (
          <>
            <Button variant="green" size="sm" onClick={() => setStatus('Accepted')}>
              Accept
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setStatus('Declined')}>
              Decline
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

interface ChatLine {
  key: string
  text: string
  fromMe: boolean
  time: string
}

/**
 * v7 channel messages, compact: consecutive lines from the same sender
 * group under one avatar + name + time; follow-up lines show their time in
 * the avatar gutter on hover.
 */
function ChatRun({ lines, gmName, gmAvatarUrl }: { lines: ChatLine[]; gmName: string; gmAvatarUrl: string | null }) {
  return (
    <>
      {lines.map((m, i) => {
        const first = i === 0 || lines[i - 1].fromMe !== m.fromMe
        return (
          <div
            key={m.key}
            className={cn(
              'group flex gap-2 rounded-md px-1.5 py-0.5 transition-colors duration-100 ease-linear hover:bg-surface-sunken',
              first && 'mt-2 first:mt-0',
            )}
          >
            <div className="flex w-[26px] shrink-0 justify-center">
              {first ? (
                m.fromMe ? (
                  <UserAvatar
                    name="You"
                    initials="Me"
                    className="mt-0.5 h-[26px] w-[26px]"
                    fallbackClassName="bg-accent-soft text-[9px] text-accent-deep"
                  />
                ) : (
                  <UserAvatar
                    src={gmAvatarUrl}
                    name={gmName}
                    className="mt-0.5 h-[26px] w-[26px]"
                    fallbackClassName="text-[9px]"
                  />
                )
              ) : (
                <span className="fs-num whitespace-nowrap text-[9px] font-medium leading-[18px] text-n-8 opacity-0 transition-opacity group-hover:opacity-100">
                  {m.time}
                </span>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {first && (
                <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
                  <span className="truncate text-[11px] font-semibold text-ink">
                    {m.fromMe ? 'You' : gmName}
                  </span>
                  <span className="fs-num shrink-0 text-[10px] font-medium text-n-6">{m.time}</span>
                </div>
              )}
              <p className="text-[11px] font-medium leading-[1.45] text-ink">{m.text}</p>
            </div>
          </div>
        )
      })}
    </>
  )
}

interface MessagesPanelProps {
  onClose: () => void
  /** Injectable for the real DM feed later; empty until that backend lands. */
  threads?: RailDmThread[]
}

/**
 * Messages tool — league DMs. The backend does not exist yet, so there are
 * no real threads in M1: the panel renders its honest empty state until the
 * messages API feeds real threads through the `threads` prop. The GM filter
 * strip, thread list, conversation view, trade card, and local composer are
 * the UI scaffold that feed will render into.
 */
export function MessagesPanel({ onClose, threads = [] }: MessagesPanelProps) {
  const [gmFilter, setGmFilter] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // Local-only sent messages, keyed by thread id (mock composer).
  const [sent, setSent] = useState<Record<string, string[]>>({})

  const visible = useMemo(
    () => threads.filter((t) => !gmFilter || t.gmName === gmFilter),
    [threads, gmFilter],
  )
  const open = openId ? threads.find((t) => t.id === openId) : null

  const send = () => {
    const text = draft.trim()
    if (!text || !open) return
    setSent((s) => ({ ...s, [open.id]: [...(s[open.id] ?? []), text] }))
    setDraft('')
  }

  if (open) {
    const extra = sent[open.id] ?? []
    return (
      <RailPanelShell title="Messages" onClose={onClose}>
        <div className="flex shrink-0 items-center gap-2 border-b border-n-4 px-2 py-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to all messages"
            onClick={() => setOpenId(null)}
          >
            <Icon name="arrow-prev" />
          </Button>
          <UserAvatar
            src={open.gmAvatarUrl}
            name={open.gmName}
            className="h-6 w-6 shrink-0"
            fallbackClassName="text-[9px]"
          />
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-bold leading-tight text-ink">
              {open.gmName}
            </span>
            <span className="block truncate text-[10px] font-medium leading-tight text-n-6">
              {open.teamName} · {open.leagueName}
            </span>
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-1.5 py-2.5">
          <div className="flex-1" aria-hidden />
          <ChatRun
            lines={open.messages.map((m) => ({ key: m.id, text: m.text, fromMe: m.fromMe, time: m.time }))}
            gmName={open.gmName}
            gmAvatarUrl={open.gmAvatarUrl}
          />
          {open.trade && (
            <div className="pl-[40px] pr-1.5">
              <TradeCard trade={open.trade} />
            </div>
          )}
          {extra.length > 0 && (
            <div className="mt-2">
              <ChatRun
                lines={extra.map((text, i) => ({ key: `sent-${i}`, text, fromMe: true, time: 'now' }))}
                gmName={open.gmName}
                gmAvatarUrl={open.gmAvatarUrl}
              />
            </div>
          )}
        </div>

        <div className="shrink-0 px-2.5 pb-2.5">
          <div className="flex items-center gap-1 rounded-lg bg-white py-1 pl-2.5 pr-1 shadow-ring-chip transition-shadow duration-150 ease-linear focus-within:shadow-field">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send()
              }}
              placeholder={`Message ${open.gmName.split(' ')[0]}`}
              className="h-[26px] min-w-0 flex-1 bg-transparent text-[11px] font-medium text-ink outline-none placeholder:text-n-6"
            />
            <Button
              variant="blue"
              size="icon-sm"
              aria-label="Send message"
              onClick={send}
              className="rounded-pill"
            >
              <Icon name="send" />
            </Button>
          </div>
        </div>
      </RailPanelShell>
    )
  }

  return (
    <RailPanelShell title="Messages" onClose={onClose}>
      {/* GM avatar filter strip */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-n-4 px-3 py-2.5">
        <FilterChip pressed={gmFilter === null} onPressedChange={() => setGmFilter(null)}>
          All
        </FilterChip>
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-label={`${t.gmName} · ${t.teamName}`}
            aria-pressed={gmFilter === t.gmName}
            title={`${t.gmName} · ${t.teamName}`}
            onClick={() => setGmFilter(gmFilter === t.gmName ? null : t.gmName)}
            className={cn(
              'inline-flex h-btn-sm items-center rounded-pill px-0.5 transition-colors duration-100 ease-linear',
              gmFilter === t.gmName
                ? 'bg-accent-soft shadow-ring-accent'
                : 'hover:bg-surface-hover',
            )}
          >
            <UserAvatar
              src={t.gmAvatarUrl}
              name={t.gmName}
              className="h-5 w-5"
              fallbackClassName="text-[9px]"
            />
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-[5px]">
        {visible.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 px-4 py-12 text-center">
            <Icon name="comments" size={16} className="text-n-7" />
            <p className="text-[13px] font-bold text-ink">No messages yet</p>
            <p className="text-[11px] font-medium text-n-6">
              League DMs land here once league chat ships.
            </p>
          </div>
        )}

        {visible.map((t) => {
          const last = t.messages[t.messages.length - 1]
          const preview = t.trade ? `Trade proposal · ${last?.text ?? ''}` : (last?.text ?? '')
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setOpenId(t.id)}
              className="flex w-full items-start gap-[9px] rounded-[9px] p-[9px] text-left transition-colors duration-100 ease-linear hover:bg-surface-sunken"
            >
              <UserAvatar
                src={t.gmAvatarUrl}
                name={t.gmName}
                className="h-[26px] w-[26px] shrink-0"
                fallbackClassName="text-[9px]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[11px] font-semibold text-ink">
                    {t.gmName}
                  </span>
                  <span className="fs-num ml-auto shrink-0 text-[10px] font-medium text-n-6">
                    {t.lastActive}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  {t.trade && (
                    <Icon name="transfer" size={11} className="shrink-0 text-accent" />
                  )}
                  <span
                    className={cn(
                      'truncate text-[11px]',
                      t.unread > 0 ? 'font-semibold text-ink' : 'font-medium text-n-3',
                    )}
                  >
                    {preview}
                  </span>
                  {t.unread > 0 && (
                    <span className="fs-num ml-auto inline-flex h-count-chip min-w-count-chip shrink-0 items-center justify-center rounded-pill bg-accent px-1 text-[9px] font-bold leading-none text-accent-foreground">
                      {t.unread}
                    </span>
                  )}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </RailPanelShell>
  )
}
