'use client'

import { CenterNote, PillButton } from '@/components/mobile/lists/lists-parts'
import { MY_RANKINGS_HREF } from '@/components/mobile/profile/profile-ops'
import { useGoBack, useLeaveTo } from '@/components/mobile/ui/back-nav'
import { MobileScreen, MPageBar } from '@/components/mobile/ui/mobile-header'

/** Ranking history's parent: your rankings (the Rankings screen's Mine tab),
 *  where desktop's History button sits. */
export const RANKING_HISTORY_PARENT = MY_RANKINGS_HREF

/** Copy shared by the screen and its tests. */
export const RANKING_HISTORY_COPY = {
  title: 'Ranking history',
  emptyTitle: 'Past rankings live in My rankings',
  emptyBody: 'Weekly rankings finalize once their week is played. Find them under Finalized in My rankings.',
  openRankings: 'Open my rankings',
} as const

/**
 * Ranking history on the phone (`/app/weekly-ranks/history`, gap list §4
 * item 111) — the same page as desktop's, which has no history records to
 * list (no submissions table or API). Desktop's "No submissions yet" would be
 * false here: on the phone Publish is the only save (no separate submission
 * step, ruled 2026-10-15), and a ranking whose week has been played is
 * already kept, read-only, under Finalized in My rankings (the Rankings
 * screen's Mine tab). So the phone's copy points there, in its own words.
 *
 * The handoff draws no ranking history, so it extends the G pages: the page
 * bar (blue back, "Ranking history") over the Lists-style centred note.
 * Desktop's two ways out — "Back to rankings" and "Open the big board" —
 * both land on Rankings on a phone (it has one Rankings area; the big board
 * hands over to it), so the note has one blue pill to your rankings, and it
 * leaves this empty screen rather than stacking on it (`useLeaveTo`). The
 * desktop line about the big board's snapshot history is left out: the
 * phone has no big board to open. Back goes to where you came from, else
 * your rankings.
 */
export function MobileRankingHistory() {
  const goBack = useGoBack()
  const leaveTo = useLeaveTo()
  return (
    <MobileScreen
      header={<MPageBar title={RANKING_HISTORY_COPY.title} onBack={() => goBack(RANKING_HISTORY_PARENT)} />}
      className="leading-[normal]"
    >
      <div className="px-4 pb-8" data-ranking-history>
        <CenterNote
          title={RANKING_HISTORY_COPY.emptyTitle}
          body={RANKING_HISTORY_COPY.emptyBody}
          action={
            <PillButton onClick={() => leaveTo(RANKING_HISTORY_PARENT)}>{RANKING_HISTORY_COPY.openRankings}</PillButton>
          }
          className="py-16"
        />
      </div>
    </MobileScreen>
  )
}
