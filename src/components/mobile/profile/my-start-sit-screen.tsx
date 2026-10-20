'use client'

import { useState } from 'react'

import { AuthorAvatar } from '@/components/mobile/community/community-cards'
import {
  SS_FILTERS,
  SS_MODE_LABEL,
  filterSsQuestions,
  sortSsQuestions,
  ssClosesLabel,
  ssCounts,
  ssFooter,
  ssIsOpen,
  ssPostedLabel,
  ssResults,
  ssTitle,
  ssVotesReceived,
  type SsFilter,
  type SsQuestion,
  type SsQuestionMeta,
} from '@/components/mobile/profile/profile-ops'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { UsernameLink } from '@/components/shared/username-link'
import { useAuth } from '@/hooks/use-auth'
import { useMobileProfileStartSit } from '@/hooks/use-mobile-profile-start-sit'
import { cn } from '@/lib/utils'

/**
 * My start/sit (handoff `m-profile.md` S0–S6b): back, "My start/sit", the
 * three stat cards, All / Open / Closed chips with counts, then the user's
 * own questions (`start_sit_questions`) as outlined cards.
 *
 * The app's questions are two players, "who do I start?", so every card is
 * "Start 1 of 2" with two result rows. What the app doesn't record is left
 * out rather than faked: whether the poster started the player, the players'
 * actual points, a roster attachment and the verdict box (no resolution job),
 * so "Your calls right" is the design's "–". The "+" (Ask a question) is left
 * out: the composer it opens doesn't exist. The header scrolls with the
 * content.
 *
 * Back goes to where you came from — normally Profile — and to Profile when
 * nothing in the app is behind (Chris, 2026-10-15, gap list #26/#27; the
 * handoff's `goHome` is overruled).
 */
export function MyStartSitScreen() {
  const goBack = useGoBack()
  const { user } = useAuth()
  const [filter, setFilter] = useState<SsFilter>('all')
  const { data, isLoading, isError, refetch } = useMobileProfileStartSit(user?.id)
  const loading = isLoading || !user
  // Read once per render — the open/closed split is a moment in time.
  const now = Date.now()
  const all = data ?? []
  const counts = ssCounts(all, now)
  const shown = sortSsQuestions(filterSsQuestions(all, filter, now), now)

  return (
    <MobileScreen>
      <div className="px-4 pb-6">
        <div className="flex h-[52px] items-center gap-2.5">
          <button
            type="button"
            onClick={() => goBack('/app/profile')}
            aria-label="Back"
            className="flex size-[34px] flex-none items-center justify-center rounded-full bg-m-b2 text-m-t1"
          >
            <MIcon name="back" size={16} stroke={2} />
          </button>
        </div>

        <h2 className="text-[26px] font-bold leading-normal tracking-[-0.03em]">My start/sit</h2>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat value={data ? counts.all.toLocaleString('en-US') : '–'} label="Questions" />
          <Stat value={data ? ssVotesReceived(all).toLocaleString('en-US') : '–'} label="Votes received" />
          <Stat value="–" label="Your calls right" />
        </div>

        <div className="mt-[14px] flex gap-1.5" role="group" aria-label="Filter questions">
          {SS_FILTERS.map((f) => {
            const on = f.value === filter
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(f.value)}
                className={cn(
                  'flex h-[30px] items-center gap-[5px] whitespace-nowrap rounded-pill px-3 text-[13px] font-semibold',
                  on ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1',
                )}
              >
                {f.label}
                {data && <span className="text-[11px] tabular-nums opacity-60">{counts[f.value]}</span>}
              </button>
            )
          })}
        </div>

        <div className="mt-3 flex flex-col gap-2.5">
          {loading ? (
            <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-2.5">
              {[0, 1].map((i) => (
                <span key={i} className="h-[188px] rounded-[18px] bg-m-b1" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-2 py-9 text-center">
              <p className="text-[13px] font-medium text-m-t3">Couldn’t load your questions.</p>
              <button type="button" onClick={() => void refetch()} className="text-[13px] font-semibold text-accent">
                Try again
              </button>
            </div>
          ) : shown.length === 0 ? (
            <p className="py-9 text-center text-[13px] font-medium text-m-t3">No questions here yet</p>
          ) : (
            shown.map((q) => <QuestionCard key={q.id} q={q} now={now} />)
          )}
        </div>
      </div>
    </MobileScreen>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] bg-m-b1 px-3 py-2.5">
      <span className="text-[18px] font-bold tabular-nums">{value}</span>
      <span className="whitespace-nowrap text-[10px] font-medium text-m-t3">{label}</span>
    </div>
  )
}

/** Who asked a question, for a card shown outside My start/sit. */
export interface SsCardAuthor {
  profileId: string
  username: string
  avatarUrl: string | null
  /** The author row's right-hand meta (`ssQuestionMeta`: `PPR · Week 5`). */
  meta: SsQuestionMeta
}

/**
 * Outlined card (§2 S0.5): mode + status pills, title, result rows, footer.
 *
 * On a question's own page (`author`) it opens with Community's poll-card
 * author row (m-community §2.8 item 1) — the asker's avatar, @handle (a door
 * to their profile) and when they asked, with the week on the right — so the
 * posting time moves there from the pills row.
 */
export function QuestionCard({ q, now, author }: { q: SsQuestion; now: number; author?: SsCardAuthor }) {
  const open = ssIsOpen(q, now)
  const r = ssResults(q)
  const options = [q.playerA, q.playerB] as const
  const posted = ssPostedLabel(q.createdAt, now)

  return (
    <article className="flex flex-col gap-2.5 rounded-[18px] p-[14px] shadow-m-outline">
      {author && (
        <div className="flex items-center gap-2" data-ss-author>
          <AuthorAvatar
            author={{ profileId: author.profileId, username: author.username, avatarUrl: author.avatarUrl, followers: null, isPersona: false }}
            size={26}
          />
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
            <UsernameLink username={author.username} />
            {posted && <span className="font-medium text-m-t3"> · {posted}</span>}
          </span>
          {/* At most half the row, so a long scoring name can't push the
              @handle (the door to the asker's profile) off the card: the
              scoring name cuts off with an ellipsis, the week always shows. */}
          <span className="flex min-w-0 max-w-[50%] whitespace-nowrap text-[10px] font-semibold text-m-t3" data-ss-meta>
            {author.meta.scoring && (
              <>
                <span className="min-w-0 truncate">{author.meta.scoring}</span>
                <span className="flex-none whitespace-pre"> · </span>
              </>
            )}
            <span className="flex-none">{author.meta.week}</span>
          </span>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span className="flex h-[22px] items-center whitespace-nowrap rounded-pill bg-confirm px-[9px] text-[11px] font-bold text-white">
          {SS_MODE_LABEL}
        </span>
        {open ? (
          <span className="flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-pill bg-m-gg px-[9px] text-[11px] font-semibold text-m-tg">
            <span className="size-1.5 flex-none rounded-full bg-confirm" aria-hidden />
            Open · closes {ssClosesLabel(q.closesAt, now)}
          </span>
        ) : (
          <span className="flex h-[22px] items-center whitespace-nowrap rounded-pill bg-m-b2 px-[9px] text-[11px] font-semibold text-m-t2">
            Closed
          </span>
        )}
        {!author && (
          <>
            <span className="flex-1" />
            <span className="whitespace-nowrap text-[11px] font-medium text-m-t3">{posted}</span>
          </>
        )}
      </div>

      <p className="text-pretty text-[15px] font-semibold leading-[1.3]">{ssTitle(q)}</p>

      <div className="flex flex-col gap-1">
        {options.map((p, i) => (
          <div
            key={p.id}
            className="relative flex min-h-[40px] items-center gap-2 overflow-hidden rounded-[10px] bg-m-b1 py-1 pl-1.5 pr-2.5"
          >
            <span
              aria-hidden
              className={cn('absolute inset-y-0 left-0', r.top[i] ? 'bg-m-gg' : 'bg-m-b3')}
              style={{ width: `${r.pcts[i]}%` }}
            />
            <span className="relative flex flex-none">
              <MHeadshot player={p} size={28} />
            </span>
            <span className="relative flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-semibold">{p.full_name}</span>
            </span>
            <span
              className={cn(
                'relative flex-none text-[14px] font-bold tabular-nums',
                r.top[i] ? 'text-m-tg' : 'text-m-t3',
              )}
            >
              {r.pcts[i]}%
            </span>
          </div>
        ))}
      </div>

      <p className="text-[11px] font-medium text-m-t3">{ssFooter(q, now)}</p>
    </article>
  )
}
