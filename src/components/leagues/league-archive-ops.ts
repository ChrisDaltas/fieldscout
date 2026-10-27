/**
 * League archive — the pure half (F716, Chris 2026-10-27: leagues are
 * archived, never deleted; the commissioner can restore). Migration 212.
 *
 * Who may archive, and what every screen says about it. "Prevent, don't
 * refuse": a co-commissioner or a manager never meets a refusal — the
 * danger zone shows him the reason instead of the button; a commissioner
 * mid-draft sees the button disabled with its reason. The server refuses
 * the same cases anyway (212's gate) — this is the UI's half of one rule.
 */

export type ArchiveGate =
  /** The commissioner, and nothing blocks it. */
  | { kind: 'archive' }
  /** The commissioner, but the draft is in progress (212 / D781). */
  | { kind: 'blocked'; reason: string }
  /** Not the commissioner: the reason replaces the button. */
  | { kind: 'not_commissioner'; reason: string }

export const ARCHIVE_DRAFT_REASON = 'The draft is in progress — finish or reset the draft before archiving the league.'
export const ARCHIVE_CO_COMMISH_REASON = 'Only the commissioner can archive the league — co-commissioners can’t.'
export const ARCHIVE_MEMBER_REASON = 'Only the commissioner can archive the league.'

export interface ArchiveGateInput {
  /** `LeagueDetail.my_role` — commissioner | co_commissioner | manager | null. */
  role: string | null
  /** `leagues.status`. */
  status: string
  /** The real draft's status (`LeagueDetail.active_draft`), or null. */
  draftStatus: string | null
}

export function archiveGate({ role, status, draftStatus }: ArchiveGateInput): ArchiveGate {
  if (role === 'co_commissioner') return { kind: 'not_commissioner', reason: ARCHIVE_CO_COMMISH_REASON }
  if (role !== 'commissioner') return { kind: 'not_commissioner', reason: ARCHIVE_MEMBER_REASON }
  if (status === 'drafting' || draftStatus === 'live' || draftStatus === 'paused') {
    return { kind: 'blocked', reason: ARCHIVE_DRAFT_REASON }
  }
  return { kind: 'archive' }
}

export const DANGER_ZONE_TITLE = 'Danger zone'
export const ARCHIVE_TITLE = 'Archive league'
export const ARCHIVE_NOTE =
  'Hides the league from every member’s league list and freezes it. Nothing is deleted — you can restore it any time.'

/** The confirm's lines, in order. `inSeason` / `draftScheduled` add the
 *  two consequences that only apply then. */
export function archiveConfirmLines(opts: { inSeason: boolean; draftScheduled: boolean }): string[] {
  const lines = [
    'It disappears from every member’s league list.',
    'Nothing in it changes while it’s archived — no waivers, trades, lineup moves, scoring or new weeks.',
    'Nothing is deleted. Restore it any time from Leagues › Archived leagues, and it comes back exactly as it was.',
  ]
  if (opts.inSeason) {
    lines.push(
      'When you restore it, anything that came due meanwhile happens under the league’s usual rules: waivers run, offers past the trade deadline expire, and weeks played meanwhile score with the lineups the teams had.',
    )
  }
  if (opts.draftScheduled) {
    lines.push('A draft time that passes while it’s archived won’t start the draft — after restoring, start it or pick a new time.')
  }
  return lines
}

export const ARCHIVE_CONFIRM_BUTTON = 'Archive league'
export const ARCHIVE_DONE_TOAST = 'League archived'
export const ARCHIVE_DONE_TOAST_BODY = 'Find it under Archived leagues on your Leagues page.'

export const ARCHIVED_SECTION_TITLE = 'Archived leagues'
export const ARCHIVED_SECTION_NOTE = 'Archived leagues keep all their history. Nothing in them changes until the commissioner restores them.'
export const ARCHIVED_LOAD_FAILED = 'Couldn’t load your archived leagues.'
export const RESTORE_BUTTON = 'Restore'
export const RESTORE_ONLY_COMMISH = 'Only the commissioner can restore it.'
export const RESTORE_CONFIRM_BODY =
  'It comes back exactly as it was, in every member’s league list. Anything that came due while it was archived happens now under the league’s usual rules — waivers run, offers past the trade deadline expire, and finished weeks are scored and closed.'
export const RESTORE_CONFIRM_BUTTON = 'Restore league'
export const RESTORE_DONE_TOAST = 'League restored'

/** "Archived Oct 27" — display only; the stored value is an instant. */
export function archivedOn(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Archived'
  return `Archived ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}
