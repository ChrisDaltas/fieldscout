/**
 * Pure helpers for the phone's Mock drafts screens (`/app/mocks` and
 * `/app/mocks/[id]/report`, gap list §4 item 110). No time, DOM or fetch.
 */

import { recapBuysInOrder, recapPicksByRound } from '@/components/draft/draft-recap-ops'
import { MOCK_PAUSED_EXPIRY_NOTE } from '@/components/draft/mock-launcher-ops'
import { PRACTICE_HOME_HREF } from '@/components/draft/room-scope'
import type { DraftPickSummary } from '@/hooks/use-draft'
import type { MockDraftLists, MockDraftSummary } from '@/hooks/use-mock-drafts'

/** Where the practice home's Back goes when nothing in the app is behind
 *  it: Home, whose Practice card opens it. */
export const MOCKS_PARENT = '/app'

/** Where a report's Back goes when nothing is behind it: the practice home,
 *  the one list of every report (never a league — F119). */
export const MOCK_REPORT_PARENT = PRACTICE_HOME_HREF

/** The practice home's words (desktop's, where desktop has them). */
export const MOCKS_COPY = {
  emptyTitle: 'No practice drafts yet',
  emptyBody: 'Your runs and their reports will list here.',
  loadFailed: 'Couldn’t load your practice drafts.',
  offline: 'Your practice drafts haven’t loaded because the browser reports no network connection.',
  refreshFailed: 'Your practice drafts couldn’t be refreshed.',
} as const

/** The report's words (desktop's, where desktop has them). */
export const MOCK_REPORT_COPY = {
  title: 'Mock draft report',
  missingTitle: 'No report here yet',
  missingBody: 'A report appears once a practice draft finishes. This one may still be running, or it may have been deleted.',
  backToMocks: 'Back to practice drafts',
  loadFailed: 'Couldn’t load this report.',
  noBuys: 'No player was bought before this draft ended.',
  noPicks: 'No player was drafted before this draft ended.',
  deleteTitle: 'Delete this practice report?',
  deleteBody: 'Every pick from this practice run goes away for good. It only ever was practice — nothing else is touched.',
  keep: 'Keep it',
  delete: 'Delete report',
} as const

/** One section of the practice home: what you can go back to, then what
 *  you did. The expiry note is only true of the first. */
export interface MockSection {
  key: 'active' | 'recaps'
  title: string
  rows: MockDraftSummary[]
  note: string | null
}

/** The sections to draw, in order, leaving out an empty one. */
export function mockSections(lists: MockDraftLists): MockSection[] {
  const sections: MockSection[] = []
  if (lists.active.length > 0) sections.push({ key: 'active', title: 'In progress', rows: lists.active, note: MOCK_PAUSED_EXPIRY_NOTE })
  if (lists.recaps.length > 0) sections.push({ key: 'recaps', title: 'Finished', rows: lists.recaps, note: null })
  return sections
}

/** One of the report's two totals tiles. */
export interface ReportStat {
  label: string
  value: string
}

/**
 * The report's totals, said once (desktop's stat tiles): an auction's buys
 * and what was spent, or a snake / linear draft's picks and rounds. The
 * counts are the same live picks the list shows (undone picks never count).
 */
export function mockReportStats(
  draft: { draft_type: string; total_rounds: number | null },
  picks: readonly DraftPickSummary[],
  teamCount: number,
): { count: number; stats: [ReportStat, ReportStat] } {
  if (draft.draft_type === 'auction') {
    const buys = recapBuysInOrder(picks)
    const spent = buys.reduce((sum, pick) => sum + (pick.price ?? 0), 0)
    return {
      count: buys.length,
      stats: [
        { label: buys.length === 1 ? 'Buy' : 'Buys', value: String(buys.length) },
        { label: 'Spent', value: `$${spent}` },
      ],
    }
  }
  const drafted = recapPicksByRound(picks, teamCount)
  return {
    count: drafted.length,
    stats: [
      { label: drafted.length === 1 ? 'Pick' : 'Picks', value: String(drafted.length) },
      { label: 'Rounds', value: String(draft.total_rounds ?? 0) },
    ],
  }
}

/** Said when some seats' names couldn't be read — a broken draft, not a
 *  small one, so it says so rather than letting "Team" read as complete. */
export function seatsMissingLine(missing: number, total: number): string | null {
  if (missing <= 0) return null
  return `${missing} of ${total} seats couldn’t be read, so some rows show no team name.`
}

/** "Finished Oct 12" — when a practice draft ended, or plain "Finished"
 *  for one that stored no time. */
export function mockFinishedLabel(completedAt: string | null): string {
  if (!completedAt) return 'Finished'
  return `Finished ${new Date(completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}
