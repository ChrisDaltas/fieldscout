'use client'

import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'

import { MockLaunchDialog } from '@/components/draft/mock-launch-dialog'
import { mockRoomHref } from '@/components/draft/mock-launcher-entry'
import {
  launchDisabledReason,
  MOCK_CAP_NOTE,
  mockSeatCount,
  practiceHomeOpenBlocked,
} from '@/components/draft/mock-launcher-ops'
import { PracticeCard } from '@/components/mobile/home/home-practice'
import { HomeSectionTitle } from '@/components/mobile/home/home-section'
import { CenterNote, InlineError, PillButton } from '@/components/mobile/lists/lists-parts'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MNotice } from '@/components/mobile/ui/m-form'
import { MobileScreen, MPageBar } from '@/components/mobile/ui/mobile-header'
import { useMyMockDrafts } from '@/hooks/use-mock-drafts'
import { useRoomEntryTarget } from '@/hooks/use-room-entry-target'
import type { RoomEntryTargetProps } from '@/hooks/use-room-entry-target-ops'
import { featureFlags } from '@/lib/feature-flags'

import { MOCKS_COPY, MOCKS_PARENT, mockSections, type MockSection } from './mocks-ops'
import { PracticeRow } from './practice-row'

/**
 * Mock drafts on the phone (`/app/mocks`, gap list §4 item 110) — the same
 * practice home as desktop's (`MocksHome`): every mock you launched, in
 * progress and finished, league or not, from the same read
 * (`useMyMockDrafts`, `GET /api/mocks`), and the one launcher. Desktop is
 * unchanged.
 *
 * The handoff draws only Home's Mock draft card, so the page is built from
 * the phone pieces it does draw:
 *  - the G-page bar (blue back, "Mock drafts"); Back goes to where you came
 *    from, else Home;
 *  - Home's Mock draft card (`PracticeCard`) at the top: it opens the phone
 *    launch sheet (`MockLaunchDialog layout="mobile"`), and a launch lands
 *    in the room, as it does from Home. With three practice drafts running
 *    (§22.5's cap — this list is the set the server counts) the card is
 *    off and an orange note says why, so you can't start a launch the
 *    server would refuse;
 *  - "In progress" and "Finished", each a b1 card of practice rows
 *    (`PracticeRow`, shared with the League tab's pre-draft list): status,
 *    what it was, progress or the day it finished, Rejoin / Resume or View
 *    report, and Delete. The 72-hour note sits under In progress only.
 *    An unfinished league mock while leagues are hidden has its Rejoin off,
 *    with the reason (`practiceHomeOpenBlocked`, desktop's rule).
 * Loading rows, "No practice drafts yet" (desktop's words, with the caps
 * line), and a failed read says so with Try again — never an empty list it
 * can't vouch for; a failed refresh keeps the rows.
 */
export function MobileMocks() {
  const router = useRouter()
  const goBack = useGoBack()
  const mocks = useMyMockDrafts()
  const roomEntry = useRoomEntryTarget()
  const [launchOpen, setLaunchOpen] = useState(false)
  const lists = mocks.data
  const retry = () => void mocks.refetch()
  // The last list we read is the set the cap counts; with none read yet the
  // launcher stays open and the server's own refusal is the answer.
  const capReason = lists ? launchDisabledReason(lists.active.length) : null

  let body: ReactNode
  if (!lists) {
    body = mocks.isError ? (
      <CenterNote title={MOCKS_COPY.loadFailed} body={mocks.error.message} action={<PillButton onClick={retry}>Try again</PillButton>} />
    ) : mocks.fetchStatus === 'paused' ? (
      <CenterNote title={MOCKS_COPY.loadFailed} body={MOCKS_COPY.offline} action={<PillButton onClick={retry}>Try again</PillButton>} />
    ) : (
      <MocksSkeleton />
    )
  } else {
    const sections = mockSections(lists)
    body = (
      <>
        {/* A refresh that failed under rows that still show. */}
        {mocks.isError && <InlineError message={MOCKS_COPY.refreshFailed} onRetry={retry} />}
        {sections.length === 0 ? (
          <div className="flex flex-col items-center" data-mocks-empty>
            <CenterNote title={MOCKS_COPY.emptyTitle} body={MOCKS_COPY.emptyBody} className="pb-2" />
            <p className="px-5 text-center text-[12px] font-medium leading-[1.35] text-m-t3 [text-wrap:balance]">{MOCK_CAP_NOTE}</p>
          </div>
        ) : (
          sections.map((section) => <MockSectionCard key={section.key} section={section} roomEntry={roomEntry} />)
        )}
      </>
    )
  }

  return (
    <MobileScreen header={<MPageBar title="Mock drafts" onBack={() => goBack(MOCKS_PARENT)} />} className="leading-[normal]">
      <div className="flex flex-col gap-[22px] px-4 pb-8 pt-3" data-mocks>
        <div className="flex flex-col gap-2">
          <PracticeCard onStart={() => setLaunchOpen(true)} disabled={capReason !== null} />
          {capReason && <MNotice tone="warning">{capReason}</MNotice>}
        </div>
        {body}
      </div>
      <MockLaunchDialog
        layout="mobile"
        open={launchOpen}
        onOpenChange={setLaunchOpen}
        onLaunched={(created) => {
          setLaunchOpen(false)
          router.push(mockRoomHref(created.id))
        }}
      />
    </MobileScreen>
  )
}

function MockSectionCard({ section, roomEntry }: { section: MockSection; roomEntry: RoomEntryTargetProps }) {
  return (
    <section className="flex flex-col gap-[10px]" aria-label={section.title} data-mock-section={section.key}>
      <HomeSectionTitle
        title={section.title}
        right={<span className="text-[13px] font-medium tabular-nums text-m-t3">{section.rows.length}</span>}
        className="px-1"
      />
      <div className="flex flex-col rounded-[16px] bg-m-b1 px-3.5">
        {section.rows.map((row) => (
          <PracticeRow
            key={row.id}
            leagueId={row.league_id}
            row={row}
            // No league to read a seat count from here: a standalone row
            // carries its own, and a league row honestly reports none.
            seatCount={mockSeatCount(row, null)}
            // The flag read stays here, in the page (§4 rule 13).
            openBlocked={practiceHomeOpenBlocked(row, featureFlags.leagues)}
            roomEntry={roomEntry}
          />
        ))}
      </div>
      {section.note && <p className="px-1 text-[12px] font-medium leading-[1.35] text-m-t3">{section.note}</p>}
    </section>
  )
}

/** Loading rows in the list's own rhythm: a title, then a b1 card. */
function MocksSkeleton() {
  return (
    <div className="flex flex-col gap-[10px]" aria-busy="true" aria-label="Loading your practice drafts" data-mocks-loading>
      <span className="block h-5 w-28 animate-pulse rounded-md bg-m-b1" />
      <span className="block h-[220px] animate-pulse rounded-[16px] bg-m-b1" />
    </div>
  )
}
