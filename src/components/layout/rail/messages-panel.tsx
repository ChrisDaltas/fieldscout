'use client'

import { useMemo, useState } from 'react'

import { RailPanelShell } from '@/components/layout/rail/rail-panel-shell'
import { Badge } from '@/components/ui/badge'
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

// TODO(live-draft): replace with real DM data. League DMs have no backend
// yet — this mock exists so the rail UI can be evaluated. When the messages
// API lands, feed threads through the `threads` prop and delete this block.
export const MOCK_DM_THREADS: RailDmThread[] = [
  {
    id: 'dm-marcus',
    gmName: 'Marcus Webb',
    gmAvatarUrl: null,
    teamName: 'Blitz Krieg',
    leagueName: 'League of Ordinary Gentlemen',
    lastActive: '2h',
    unread: 2,
    messages: [
      { id: 'm1', text: 'You still shopping a WR2?', fromMe: false, time: 'Tue 9:14' },
      { id: 'm2', text: 'Depends what you are offering.', fromMe: true, time: 'Tue 9:20' },
      { id: 'm3', text: 'Sent you something — take a look.', fromMe: false, time: '2h ago' },
    ],
    trade: {
      give: ['Jaylen Waddle', '2027 3rd'],
      get: ['Tony Pollard', 'Cade Otton'],
    },
  },
  {
    id: 'dm-priya',
    gmName: 'Priya Shah',
    gmAvatarUrl: null,
    teamName: 'Shah-lom Chiefs',
    leagueName: 'League of Ordinary Gentlemen',
    lastActive: '5h',
    unread: 1,
    messages: [
      { id: 'm1', text: 'Your kicker is on bye this week btw', fromMe: false, time: '5h ago' },
    ],
  },
  {
    id: 'dm-dre',
    gmName: 'Dre Coleman',
    gmAvatarUrl: null,
    teamName: 'Coleman Cookers',
    leagueName: 'Dynasty Degenerates',
    lastActive: '1d',
    unread: 0,
    messages: [
      { id: 'm1', text: 'gg last week', fromMe: false, time: 'Mon 8:02' },
      { id: 'm2', text: 'You got lucky on Monday night.', fromMe: true, time: 'Mon 8:15' },
    ],
  },
  {
    id: 'dm-sam',
    gmName: 'Sam Ferris',
    gmAvatarUrl: null,
    teamName: 'Ferris Wheelers',
    leagueName: 'The Work League',
    lastActive: '3d',
    unread: 0,
    messages: [
      { id: 'm1', text: 'Draft order poll is up in the group.', fromMe: false, time: 'Fri 3:40' },
    ],
  },
]

/** Sum of unread DMs — drives the lime badge on the rail strip. */
export function mockDmUnreadCount(threads: RailDmThread[] = MOCK_DM_THREADS): number {
  return threads.reduce((sum, t) => sum + t.unread, 0)
}

function TradeCard({ trade }: { trade: RailTradeProposal }) {
  const [status, setStatus] = useState<'Accepted' | 'Declined' | null>(null)
  // TODO(live-draft): wire accept/decline to the real trade endpoint.
  return (
    <div className="my-1 rounded-sm border border-ink bg-white">
      <div className="flex items-center gap-1.5 border-b border-n-4 px-2.5 py-1.5">
        <Icon name="transfer" size={12} className="text-accent" />
        <span className="text-[9px] font-bold uppercase tracking-wider text-n-3">
          Trade proposal
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 px-2.5 py-2">
        <div>
          <p className="mb-1 text-[9px] font-medium text-n-3">You give</p>
          {trade.give.map((name) => (
            <p key={name} className="text-[11px] font-bold leading-relaxed text-ink">
              {name}
            </p>
          ))}
        </div>
        <div>
          <p className="mb-1 text-[9px] font-medium text-n-3">You get</p>
          {trade.get.map((name) => (
            <p key={name} className="text-[11px] font-bold leading-relaxed text-ink">
              {name}
            </p>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 px-2.5 pb-2">
        {status ? (
          <Badge variant={status === 'Accepted' ? 'green' : 'stroke'}>{status}</Badge>
        ) : (
          <>
            <Button variant="green" size="sm" onClick={() => setStatus('Accepted')}>
              Accept
            </Button>
            <Button variant="stroke" size="sm" onClick={() => setStatus('Declined')}>
              Decline
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

interface MessagesPanelProps {
  onClose: () => void
  /** Injectable for the real DM feed later; defaults to the mock threads. */
  threads?: RailDmThread[]
}

/**
 * Messages tool — league DMs. UI only: the backend does not exist yet, so
 * everything renders from typed mock threads (see TODO(live-draft) above).
 * GM avatar filter strip on top, thread list below; opening a thread shows
 * the conversation with an optional trade proposal card and a local-only
 * composer.
 */
export function MessagesPanel({ onClose, threads = MOCK_DM_THREADS }: MessagesPanelProps) {
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
        <div className="flex shrink-0 items-center gap-2 border-b border-n-4 px-3 py-2">
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
            <span className="block truncate text-[10px] font-medium leading-tight text-n-3">
              {open.teamName} · {open.leagueName}
            </span>
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-3">
          <div className="flex-1" aria-hidden />
          {open.messages.map((m) => (
            <div
              key={m.id}
              className={cn('max-w-[82%]', m.fromMe ? 'self-end' : 'self-start')}
            >
              <p
                className={cn(
                  'rounded-sm border border-ink px-2.5 py-1.5 text-[11px] font-medium leading-normal',
                  m.fromMe ? 'bg-accent text-accent-foreground' : 'bg-n-4 text-ink',
                )}
              >
                {m.text}
              </p>
              <p
                className={cn(
                  'fs-num mt-0.5 text-[9px] font-medium text-n-3',
                  m.fromMe ? 'text-right' : 'text-left',
                )}
              >
                {m.time}
              </p>
            </div>
          ))}
          {open.trade && <TradeCard trade={open.trade} />}
          {extra.map((text, i) => (
            <div key={`sent-${i}`} className="max-w-[82%] self-end">
              <p className="rounded-sm border border-ink bg-accent px-2.5 py-1.5 text-[11px] font-medium leading-normal text-accent-foreground">
                {text}
              </p>
              <p className="fs-num mt-0.5 text-right text-[9px] font-medium text-n-3">
                now
              </p>
            </div>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 border-t border-ink p-2.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
            }}
            placeholder={`Message ${open.gmName.split(' ')[0]}`}
            className="h-[29px] min-w-0 flex-1 rounded-sm border border-ink bg-white px-2.5 text-[11px] font-medium text-ink outline-none transition-colors duration-200 ease-linear placeholder:text-n-3 focus:border-accent"
          />
          <Button variant="blue" size="icon-sm" aria-label="Send message" onClick={send}>
            <Icon name="send" />
          </Button>
        </div>
      </RailPanelShell>
    )
  }

  return (
    <RailPanelShell title="Messages" onClose={onClose}>
      {/* GM avatar filter strip */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-ink px-3 py-2">
        <button
          type="button"
          aria-pressed={gmFilter === null}
          onClick={() => setGmFilter(null)}
          className={cn(
            'inline-flex h-[26px] items-center rounded-sm border px-2 text-[11px] font-bold transition-colors duration-200 ease-linear',
            gmFilter === null
              ? 'border-ink bg-accent text-accent-foreground'
              : 'border-ink bg-white text-ink hover:bg-n-4',
          )}
        >
          All
        </button>
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-label={`${t.gmName} · ${t.teamName}`}
            aria-pressed={gmFilter === t.gmName}
            title={`${t.gmName} · ${t.teamName}`}
            onClick={() => setGmFilter(gmFilter === t.gmName ? null : t.gmName)}
            className={cn(
              'rounded-sm border p-0.5 transition-colors duration-200 ease-linear',
              gmFilter === t.gmName
                ? 'border-accent bg-accent-soft'
                : 'border-transparent hover:bg-n-4',
            )}
          >
            <UserAvatar
              src={t.gmAvatarUrl}
              name={t.gmName}
              className="h-6 w-6"
              fallbackClassName="text-[9px]"
            />
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {visible.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 px-4 py-12 text-center">
            <Icon name="comments" size={16} className="text-n-3" />
            <p className="text-[12px] font-bold text-ink">No messages yet</p>
            <p className="text-[11px] font-medium text-n-3">
              League DMs land here once your leagues go live.
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
              className="flex w-full items-start gap-2.5 border-b border-n-4 px-3 py-2.5 text-left transition-colors duration-200 ease-linear hover:bg-n-4"
            >
              <UserAvatar
                src={t.gmAvatarUrl}
                name={t.gmName}
                className="h-7 w-7 shrink-0"
                fallbackClassName="text-[9px]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[12px] font-bold text-ink">
                    {t.gmName}
                  </span>
                  <span className="fs-num ml-auto shrink-0 text-[9px] font-medium text-n-3">
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
                      t.unread > 0 ? 'font-bold text-ink' : 'font-medium text-n-3',
                    )}
                  >
                    {preview}
                  </span>
                  {t.unread > 0 && (
                    <span className="fs-num ml-auto inline-flex h-[14px] min-w-[14px] shrink-0 items-center justify-center rounded-pill bg-brand px-1 text-[9px] font-bold leading-none text-ink">
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
