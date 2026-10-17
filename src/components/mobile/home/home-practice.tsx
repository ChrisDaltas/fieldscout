'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { MockLaunchDialog } from '@/components/draft/mock-launch-dialog'
import { mockRoomHref } from '@/components/draft/mock-launcher-entry'

import { HomeSectionTitle } from './home-section'

/**
 * "Practice" (m-home §2A.12): the Mock draft card. The whole card opens the
 * app's one practice-draft launcher (`MockLaunchDialog`, as the desktop
 * Home's Mock chip does) and a launch lands in the room. Rendered only while
 * practice drafts are released (`featureFlags.mockDrafts`, by the caller).
 */
export function HomePractice() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <section>
      <HomeSectionTitle title="Practice" className="mt-[22px]" />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-[10px] flex w-full items-center gap-3 rounded-[18px] bg-m-b1 p-[14px] text-left"
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
      <MockLaunchDialog
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
