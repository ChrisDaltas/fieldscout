/**
 * The Commissioner Console's pure half — M6 task L.E1.33 (spec §10.1 as
 * folded by v2.16.77: the console is the commissioner's LAUNCHPAD — what
 * needs him now, one door per kind of tool, his last few actions; PROGRESS
 * Q87 → D443 (TD11), D446 (prevent, don't refuse), D455 (the summary read),
 * F535, D457 (this build)).
 *
 * **Doors, never copies (TD11).** Every tool stays where M6A / M5 built it —
 * the team page, the matchup page, the trade center, settings, the schedule,
 * the playoffs tab, the draft room, League Home's invite panel. This file
 * only decides WHICH doors a league in a given state has and what they say;
 * the console turns override mode on as a door is followed (the one store,
 * `commish-override-store.ts`), so he lands on the screen ready to act.
 *
 * **Prevent, don't refuse (D446 / F535).** No door is offered to a screen
 * that would refuse him or has nothing to do yet: the team / score / trade
 * / schedule doors appear once the draft has made rosters; a matchup the
 * server says cannot be corrected yet gets its sentence and no door (F535(c));
 * a team with no seat row gets words and no door (F535(b)); a section the
 * database cannot answer yet says so and never reads as "nothing needs you"
 * (F535(a)).
 *
 * **The client computes nothing** (CLAUDE.md): every item is the summary's —
 * which teams, which trades, which matchups and whether each can be corrected
 * are the server's answers (135's lock door, verbatim). Plain football words
 * only; no action type, setting key or status value reaches the screen.
 */
import type {
  CommishSummary,
  MatchupCorrectionItem,
  TeamRef,
  UnavailableSection,
} from '@/lib/leagues/api/commish-summary-service'
import { commishConsoleHref } from '@/lib/leagues/api/commish-console-gate'
import type { TradeView } from '@/lib/leagues/api/trades-service'

import { teamPageHref } from './league-cells'
import { tradesHref } from './trades-ops'

export { commishConsoleHref }

// ---------------------------------------------------------------------------
// Phase — which part of the season the league is in
// ---------------------------------------------------------------------------

export type ConsolePhase = 'setup' | 'scheduled' | 'drafting' | 'in_season' | 'playoffs' | 'complete' | 'other'

/** `leagues.status` → the console's phase (the six-state enum; anything else
 *  is `other`, which offers settings only — never a guess). */
export function consolePhase(status: string): ConsolePhase {
  switch (status) {
    case 'setup':
    case 'scheduled':
    case 'drafting':
    case 'in_season':
    case 'playoffs':
    case 'complete':
      return status
    default:
      return 'other'
  }
}

/** Rosters exist (the draft is done): the team, score, trade and schedule
 *  doors have something to open. */
export function afterDraft(phase: ConsolePhase): boolean {
  return phase === 'in_season' || phase === 'playoffs' || phase === 'complete'
}

export function preDraft(phase: ConsolePhase): boolean {
  return phase === 'setup' || phase === 'scheduled'
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export const CONSOLE_TITLE = 'Commissioner'
export const CONSOLE_NAV_LABEL = 'Commissioner'

export const OVERRIDE_OFF_COPY =
  'Override mode lets you act for any team — set a lineup, correct a score, move a player. Turn it on here, or tap any button below and it turns on for you. It stays on across pages until you turn it off.'
export const OVERRIDE_ON_COPY =
  'Override mode is on — every screen you open from here lets you act for any team. Every change is recorded and shown to the league. Exit when you’re done.'

export const NEEDS_TITLE = 'Needs you'
export const NOTHING_NEEDS_YOU_COPY =
  'Nothing needs you right now — every team has a manager or is on autopilot, and no trade is waiting for your review.'
export const NOTHING_NEEDS_YOU_PRE_DRAFT_COPY = 'Nothing needs you right now — every seat has a manager.'
export const NOTHING_NEEDS_YOU_COMPLETE_COPY = 'The season is over, and nothing needs you.'
export const NEEDS_PROBLEM_COPY = 'Couldn’t check what needs you.'

export const CORRECTIONS_TITLE = 'Correcting scores'
export const CORRECTIONS_HINT =
  'A matchup’s score or winner can be corrected once every starter on both teams has finished his game.'

export const TOOLS_TITLE = 'Tools'
export const TOOLS_AFTER_DRAFT_NOTE =
  'Team, score, trade and schedule tools open here once the draft is done.'

export const RECENT_TITLE = 'Recent actions'
/** How many of his actions the console shows (the task: "the last five"). */
export const RECENT_LIMIT = 5
export const RECENT_MORE_LABEL = 'More in league activity'

export const NOT_COMMISSIONER_COPY =
  'Only this league’s commissioner (or a co-commissioner) can use this page.'

// ---------------------------------------------------------------------------
// Needs you — the summary's items, in words, each with its door (or none)
// ---------------------------------------------------------------------------

export interface ConsoleDoor {
  label: string
  href: string
  /** A door INTO the draft room: the console's Link takes DR.6's platform
   *  split (`useRoomEntryTarget` — a new tab on a measured desktop), like
   *  every other entry into the room (room-entry.test.ts). */
  room?: true
}

/** The draft room — the console's ONE spelling of its URL (room-entry.test.ts
 *  enumerates it; every draft-room door below is built here). */
function draftRoomDoor(leagueId: string, label: string): ConsoleDoor {
  return { label, href: `/app/leagues/${leagueId}/draft`, room: true }
}

export interface NeedsItem {
  key: string
  kind: 'unmanaged' | 'no_seat_row' | 'trade_review'
  /** The line — plain words, the team or trade named. */
  text: string
  /** What he can do about it, in words. */
  hint: string
  /** The one tap to the right screen (override mode turns on as he follows
   *  it) — null when there is no screen that would accept the fix. */
  door: ConsoleDoor | null
}

export interface NeedsView {
  items: NeedsItem[]
  /** Sections the database cannot answer yet — each its own sentence (F535(a)). */
  unavailable: Array<{ key: string; message: string }>
  /** True only when every section answered and none has anything in it. */
  nothing: boolean
  nothingCopy: string
}

type Sections = CommishSummary['sections']

function isUnavailable<T extends { state: string }>(section: T | UnavailableSection): section is UnavailableSection {
  return section.state === 'unavailable'
}

const teamName = (team: TeamRef | { name: string | null }) => team.name ?? 'A team'

export function unmanagedItem(leagueId: string, phase: ConsolePhase, team: TeamRef): NeedsItem {
  if (preDraft(phase)) {
    return {
      key: `unmanaged:${team.team_id}`,
      kind: 'unmanaged',
      text: `${teamName(team)} has no manager yet.`,
      hint: 'Invite someone to run it, or fill the seat before the draft.',
      door: { label: 'Invite a manager', href: `/app/leagues/${leagueId}#invites` },
    }
  }
  if (phase === 'drafting') {
    return {
      key: `unmanaged:${team.team_id}`,
      kind: 'unmanaged',
      text: `${teamName(team)} has no manager.`,
      hint: 'Autopick drafts for it. To seat a manager, open the draft room’s seat controls under Draft Options.',
      door: draftRoomDoor(leagueId, 'Draft room'),
    }
  }
  return {
    key: `unmanaged:${team.team_id}`,
    kind: 'unmanaged',
    text: `${teamName(team)} has no manager, and autopilot is off.`,
    hint: 'Open the team to set its lineup, or switch its autopilot on.',
    door: { label: 'Open team', href: teamPageHref(leagueId, team.team_id) },
  }
}

/** D339's reported state: a team with no seat row at all. The autopilot
 *  switch refuses it, so NO door (F535(b)) — said in words. */
export function noSeatRowItem(team: TeamRef): NeedsItem {
  return {
    key: `no-seat:${team.team_id}`,
    kind: 'no_seat_row',
    text: `${teamName(team)} is missing its seat in the league’s member list.`,
    hint: 'It can’t be put on autopilot and no manager can be seated until that’s fixed. This is a problem on our side — please let us know.',
    door: null,
  }
}

export function tradeReviewItem(
  leagueId: string,
  trade: TradeView,
  formatInstant: (iso: string) => string,
): NeedsItem {
  const ends = trade.review?.ends_at ?? null
  return {
    key: `trade:${trade.id}`,
    kind: 'trade_review',
    text: `${teamName(trade.proposer)} and ${teamName(trade.recipient)}’s trade is waiting for your review.`,
    hint: ends
      ? `Approve or veto it — if you do nothing it goes through on ${formatInstant(ends)}.`
      : 'Approve or veto it in the trade center.',
    door: { label: 'Review trade', href: tradesHref(leagueId) },
  }
}

/**
 * The "needs you" list. A section that is `unavailable` contributes its
 * sentence and no items, and it keeps `nothing` false — the empty copy is
 * said only when EVERY section answered and none has anything in it.
 * A complete league has no more weeks to run, so a seat without a manager
 * no longer needs him (not listed).
 */
export function needsYouView(
  leagueId: string,
  phase: ConsolePhase,
  sections: Pick<Sections, 'unmanaged_teams' | 'trades_awaiting_review'>,
  formatInstant: (iso: string) => string,
): NeedsView {
  const items: NeedsItem[] = []
  const unavailable: NeedsView['unavailable'] = []

  const seats = sections.unmanaged_teams
  if (isUnavailable(seats)) {
    unavailable.push({ key: 'unmanaged_teams', message: seats.message })
  } else if (phase !== 'complete') {
    for (const team of seats.teams) items.push(unmanagedItem(leagueId, phase, team))
    for (const team of seats.no_seat_row) items.push(noSeatRowItem(team))
  }

  const trades = sections.trades_awaiting_review
  if (isUnavailable(trades)) {
    unavailable.push({ key: 'trades_awaiting_review', message: trades.message })
  } else {
    for (const trade of trades.trades) items.push(tradeReviewItem(leagueId, trade, formatInstant))
  }

  const nothingCopy =
    phase === 'complete' ? NOTHING_NEEDS_YOU_COMPLETE_COPY : preDraft(phase) || phase === 'drafting' ? NOTHING_NEEDS_YOU_PRE_DRAFT_COPY : NOTHING_NEEDS_YOU_COPY
  return { items, unavailable, nothing: items.length === 0 && unavailable.length === 0, nothingCopy }
}

// ---------------------------------------------------------------------------
// Correcting scores — the in-play weeks' matchups, split by 135's lock door
// ---------------------------------------------------------------------------

export interface CorrectionRow {
  key: string
  week: number
  /** "Alpha vs Bravo", or "Alpha (bye)". */
  label: string
  /** The door to the matchup when it can be corrected now; null otherwise. */
  door: ConsoleDoor | null
  /** The server's sentence when it cannot be corrected yet — verbatim. */
  message: string | null
}

export type CorrectionsView =
  | { kind: 'hidden' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'rows'; rows: CorrectionRow[] }

function matchupLabel(item: MatchupCorrectionItem): string {
  return item.away ? `${teamName(item.home)} vs ${teamName(item.away)}` : `${teamName(item.home)} (bye)`
}

/** Correctable ones first (each a door), then the ones that must wait (each
 *  the server's sentence and NO door — F535(c)), week by week as the server
 *  ordered them. No week in play ⇒ nothing to show. */
export function correctionsView(leagueId: string, section: Sections['matchup_corrections']): CorrectionsView {
  if (isUnavailable(section)) return { kind: 'unavailable', message: section.message }
  if (section.weeks.length === 0) return { kind: 'hidden' }
  const rows: CorrectionRow[] = [
    ...section.can_correct_now.map((item) => ({
      key: `now:${item.matchup_id}`,
      week: item.week,
      label: matchupLabel(item),
      door: { label: 'Correct score', href: `/app/leagues/${leagueId}/matchup/${item.matchup_id}` },
      message: null,
    })),
    ...section.not_yet.map((item) => ({
      key: `wait:${item.matchup_id}`,
      week: item.week,
      label: matchupLabel(item),
      door: null,
      message: item.message,
    })),
  ]
  return { kind: 'rows', rows }
}

// ---------------------------------------------------------------------------
// Tools — one door per kind of tool, in plain groups (TD11)
// ---------------------------------------------------------------------------

export type ToolGroupKey = 'draft' | 'members' | 'lineups' | 'scores' | 'trades' | 'schedule' | 'settings'

export interface ToolGroup {
  key: ToolGroupKey
  title: string
  /** What the doors reach, in words. */
  blurb: string
  doors: ConsoleDoor[]
  /** The league's teams as doors to their pages (Lineups & rosters). */
  teamDoors: boolean
  /** A sentence said under the doors (never a door that would be refused). */
  note: string | null
}

export const MEMBERS_AFTER_DRAFT_NOTE =
  'Changing who manages a team after the draft doesn’t have a screen yet.'
export const FAAB_NOTE = 'A team’s FAAB balance is set on its page — pick the team under Lineups & rosters.'

export function toolGroups(args: { leagueId: string; phase: ConsolePhase; waiverType: string | null | undefined }): ToolGroup[] {
  const { leagueId, phase } = args
  const base = `/app/leagues/${leagueId}`
  const settings: ToolGroup = {
    key: 'settings',
    title: 'League settings',
    blurb: 'Scoring, roster spots, waivers, trades and the playoffs.',
    doors: [{ label: 'League settings', href: `${base}/settings` }],
    teamDoors: false,
    note: null,
  }

  if (phase === 'setup' || phase === 'scheduled') {
    return [
      {
        key: 'draft',
        title: 'Draft',
        blurb:
          phase === 'setup'
            ? 'Set the draft’s time, type and order, then schedule it from the setup checklist.'
            : 'Start the draft early, or change its time, type and order.',
        doors:
          phase === 'setup'
            ? [
                { label: 'Setup checklist', href: base },
                { label: 'Draft settings', href: `${base}/settings` },
              ]
            : [
                draftRoomDoor(leagueId, 'Draft lobby'),
                { label: 'Draft settings', href: `${base}/settings` },
              ],
        teamDoors: false,
        note: null,
      },
      {
        key: 'members',
        title: 'Members & autopilot',
        blurb: 'Invite managers, fill empty seats, name co-commissioners or remove a manager.',
        doors: [{ label: 'Members & invites', href: `${base}#invites` }],
        teamDoors: false,
        note: null,
      },
      settings,
    ]
  }

  if (phase === 'drafting') {
    return [
      {
        key: 'draft',
        title: 'Draft',
        blurb: 'Pause, undo, fix a pick, move a player or reset the draft — under Draft Options in the room.',
        doors: [draftRoomDoor(leagueId, 'Draft room')],
        teamDoors: false,
        note: null,
      },
      {
        key: 'members',
        title: 'Members & autopilot',
        blurb: 'Swap who runs a team, or turn autopick on for any team — under Draft Options in the room.',
        doors: [draftRoomDoor(leagueId, 'Draft room')],
        teamDoors: false,
        note: null,
      },
      settings,
    ]
  }

  if (!afterDraft(phase)) return [settings]

  const scheduleDoors: ConsoleDoor[] = [{ label: 'Schedule', href: `${base}/schedule` }]
  if (phase === 'playoffs' || phase === 'complete') {
    scheduleDoors.push({ label: 'Playoff bracket', href: `${base}/standings?tab=playoffs` })
  }
  return [
    {
      key: 'lineups',
      title: 'Lineups & rosters',
      blurb: 'Set any team’s lineup, add or drop a player, move a player between teams, rename a team.',
      doors: [],
      teamDoors: true,
      note: null,
    },
    {
      key: 'scores',
      title: 'Scores & results',
      blurb: 'Correct a matchup’s score or declare its winner.',
      doors: [{ label: 'Matchups', href: `${base}/matchup` }],
      teamDoors: false,
      note: null,
    },
    {
      key: 'trades',
      title: 'Trades & waivers',
      blurb: 'Approve or veto a trade, push one through, or reverse a completed one.',
      doors: [{ label: 'Trade center', href: tradesHref(leagueId) }],
      teamDoors: false,
      note: args.waiverType === 'faab' ? FAAB_NOTE : null,
    },
    {
      key: 'schedule',
      title: 'Schedule & playoffs',
      blurb: phase === 'in_season' ? 'Change a week’s matchups or remix the rest of the schedule.' : 'Change a week’s matchups, or pick who plays whom in a playoff round.',
      doors: scheduleDoors,
      teamDoors: false,
      note: null,
    },
    settings,
    {
      key: 'members',
      title: 'Members & autopilot',
      blurb: 'Switch autopilot on for a team with no manager — on the team’s page.',
      doors: [],
      teamDoors: false,
      note: MEMBERS_AFTER_DRAFT_NOTE,
    },
  ]
}

/** "See more" of his actions: League Home's activity section is the one
 *  place the log is shown today (8 newest), and only after the draft —
 *  before it there is nowhere to send him (F538: L.E1.34's Activity page). */
export function recentMoreHref(leagueId: string, phase: ConsolePhase): string | null {
  return afterDraft(phase) ? `/app/leagues/${leagueId}#activity` : null
}
