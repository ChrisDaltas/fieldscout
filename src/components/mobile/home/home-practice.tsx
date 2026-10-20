'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { MockLaunchDialog } from '@/components/draft/mock-launch-dialog'
import { mockRoomHref } from '@/components/draft/mock-launcher-entry'
import { PRACTICE_HOME_HREF } from '@/components/draft/room-scope'
import { cn } from '@/lib/utils'

import { HomeSectionTitle } from './home-section'

/**
 * "Practice" (m-home §2A.12): the Mock draft card. The whole card opens the
 * app's one practice-draft launcher (`MockLaunchDialog`, as the desktop
 * Home's Mock chip does) as a phone sheet (`layout="mobile"`, gap list §4
 * item 2), and a launch lands in the room. Rendered only while practice
 * drafts are released (`featureFlags.mockDrafts`, by the caller).
 *
 * "Your mocks" (gap list §3 #2) sits in the title row the way Trending's
 * "See all" does: it opens the practice home (`/app/mocks`), the one page
 * listing every mock this user launched — in progress and finished — which
 * a phone otherwise reaches only from a league's pre-draft screen. Shown
 * always: with no mocks yet that page is the empty state plus Start.
 */
export function HomePractice() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <section>
      <HomeSectionTitle
        title="Practice"
        align="center"
        className="mt-[22px]"
        right={
          // 16px line box as Trending's "See all"; the padding grows the tap area to 30px without moving it.
          <Link href={PRACTICE_HOME_HREF} className="-my-[7px] py-[7px] text-[13px] font-semibold leading-[16px] text-accent">
            Your mocks
          </Link>
        }
      />
      <PracticeCard className="mt-[10px]" onStart={() => setOpen(true)} />
      <MockLaunchDialog
        layout="mobile"
        open={open}
        onOpenChange={setOpen}
        onLaunched={(created) => {
          setOpen(false)
          router.push(mockRoomHref(created.id))
        }}
      />
    </section>
  )
}

/**
 * The handoff's Mock draft card (m-home §2A.12): the ink tile, "Mock draft"
 * over "Practice against AI drafters", and the ink Start pill — the whole
 * card is the button. Home draws it under "Practice"; the phone's practice
 * home (`/app/mocks`, gap list §4 item 110) draws it at the top as its
 * launch control.
 *
 * `disabled` (the practice home's §22.5 three-running cap, known before you
 * tap): the card dims and can't be pressed — the page prints the reason
 * under it, so the card never opens a launch the server would refuse.
 */
export function PracticeCard({
  onStart,
  disabled = false,
  className,
}: {
  onStart: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onStart}
      disabled={disabled}
      className={cn('flex w-full items-center gap-3 rounded-[18px] bg-m-b1 p-[14px] text-left disabled:opacity-50', className)}
      data-practice-card
    >
      <span className="flex size-10 flex-none items-center justify-center rounded-xl bg-m-ink text-white" aria-hidden>
        <svg viewBox="0 0 16 16" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
          <path d="M2.5 6.5h11M6.5 2.5v11" />
        </svg>
      </span>
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold leading-[19px] text-m-t1">Mock draft</span>
        <span className="text-[12px] font-medium leading-[15px] text-m-t3">Practice against AI drafters</span>
      </span>
      <span className="flex h-[30px] flex-none items-center rounded-pill bg-m-ink px-[14px] text-[13px] font-semibold text-white" aria-hidden>
        Start
      </span>
    </button>
  )
}
