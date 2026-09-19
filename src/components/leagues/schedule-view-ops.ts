import type {
  LeagueSchedule,
  RemixDiffLine,
  RemixFrozenWeek,
  RemixPreview,
  RemixProposedRow,
  ScheduleMatchup,
  ScheduleWeek,
} from '@/hooks/use-schedule'

/**
 * Pure decisions for `schedule-view.tsx` and `schedule-remix-modal.tsx`
 * (spec §16.2 `schedule-view` / `schedule-remix-modal`, §16.5.2's "Schedule
 * & Remix" row, §11.7 — M4 task L.D5.3; PROGRESS D289, D290, D307, D317).
 *
 * Everything decidable without a socket or a clock lives here so it can be
 * node-tested. Two rules the file keeps:
 *
 * 1. **The server decides; this file only reads what it said.** Which of
 *    D290's two copies the modal renders is 111's `window.free`, evaluated
 *    at transaction time from `nfl_games.kickoff_at` (E41/D307(3)) — never a
 *    window computed here. **A reason is NEVER required** (Q66, spec
 *    v2.16.41; F363(c) / R1056): `window.reason_required` is the literal
 *    FALSE since migration 132 and NOTHING in this file reads it as a gate —
 *    an un-pushed database still answering `NOT free` must not be able to
 *    block a Confirm the verb (131) would land. Whether a matchup MAY be edited is likewise 111's; the
 *    affordance here (`matchupEditable`) mirrors the checks a client can see
 *    (week `upcoming`, row `scheduled`, unscored, un-overridden, a real
 *    pairing) so the button is shown where an edit can possibly succeed, and
 *    the one check it cannot see — the week's own kickoff (R730) — is the
 *    refusal rendered verbatim when it fires.
 * 2. **A datum the chain lacks is pending BY NAME (R801).** Playoff weeks
 *    (L.D1.8, Q39) render as "bracket pending"; a total-points league's weeks
 *    say why they carry no pairings (§16.5.3).
 *
 * No clock: the current week comes from the ladder (`league_weeks.status`,
 * the D316(2) reading) and every instant rendered is a stored one.
 */

// ---------------------------------------------------------------------------
// The week grid
// ---------------------------------------------------------------------------

export interface TeamRef {
  id: string
  name: string
}

export interface MatchupCell {
  id: string
  round_type: string
  status: string
  home: TeamRef
  /** null = bye (§12.8; v1 generates none, but the row shape allows it). */
  away: TeamRef | null
  home_score: number | null
  away_score: number | null
  result: string | null
  is_overridden: boolean
  /** The commissioner may TRY to edit this row (see the header). */
  editable: boolean
}

export interface WeekCell {
  week: number
  status: string
  kind: 'regular' | 'playoff'
  median_score: number | null
  rows: MatchupCell[]
  /** Why a week shows no pairings, by name — or null when it has rows. */
  note: string | null
}

export const PLAYOFF_PENDING_COPY = 'Playoff week — the bracket arrives with the playoffs engine.'
export const TOTAL_POINTS_WEEK_COPY = 'No matchups — a total-points league scores the whole field each week.'
export const NO_ROWS_COPY = 'No pairings on record for this week.'
export const NO_SCHEDULE_COPY = 'No schedule yet — it is generated the moment the draft completes.'

function teamRef(id: string, names: ReadonlyMap<string, string>): TeamRef {
  return { id, name: names.get(id) ?? 'Unknown team' }
}

/**
 * The client-visible half of 111's edit gate: an `upcoming` week's
 * `scheduled`, unscored, un-overridden regular/secondary pairing with two
 * teams. The week's own kickoff (R730) and the E41 reason law are the
 * server's — a refusal renders verbatim.
 */
export function matchupEditable(
  matchup: Pick<
    ScheduleMatchup,
    'status' | 'round_type' | 'is_overridden' | 'result' | 'home_score' | 'away_score' | 'away_team_id'
  >,
  weekStatus: string,
  isCommish: boolean,
): boolean {
  if (!isCommish) return false
  if (weekStatus !== 'upcoming') return false
  if (matchup.status !== 'scheduled') return false
  if (matchup.round_type !== 'regular' && matchup.round_type !== 'secondary') return false
  if (matchup.is_overridden || matchup.result !== null) return false
  if ((matchup.home_score ?? 0) !== 0 || (matchup.away_score ?? 0) !== 0) return false
  if (matchup.away_team_id === null) return false
  return true
}

/** Regular vs playoff by position in the ladder (§7.3.1: the regular season
 *  is the first `regular_season_weeks` league weeks; the playoffs follow —
 *  league-week terms, Q29). */
export function weekKind(
  week: number,
  firstWeek: number,
  regularSeasonWeeks: number,
): 'regular' | 'playoff' {
  return week - firstWeek < regularSeasonWeeks ? 'regular' : 'playoff'
}

export function scheduleGrid(
  schedule: LeagueSchedule,
  teamNames: ReadonlyMap<string, string>,
  settings: { regular_season_weeks: number; schedule_mode: string },
  isCommish: boolean,
): WeekCell[] {
  if (schedule.weeks.length === 0) return []
  const firstWeek = Math.min(...schedule.weeks.map((w) => w.week))
  const byWeek = new Map<number, ScheduleMatchup[]>()
  for (const m of schedule.matchups) {
    const list = byWeek.get(m.week) ?? []
    list.push(m)
    byWeek.set(m.week, list)
  }
  return [...schedule.weeks]
    .sort((a, b) => a.week - b.week)
    .map((w) => {
      const kind = weekKind(w.week, firstWeek, settings.regular_season_weeks)
      const rows = (byWeek.get(w.week) ?? []).map((m) => ({
        id: m.id,
        round_type: m.round_type,
        status: m.status,
        home: teamRef(m.home_team_id, teamNames),
        away: m.away_team_id ? teamRef(m.away_team_id, teamNames) : null,
        home_score: m.home_score,
        away_score: m.away_score,
        result: m.result,
        is_overridden: m.is_overridden,
        editable: matchupEditable(m, w.status, isCommish),
      }))
      let note: string | null = null
      if (rows.length === 0) {
        if (kind === 'playoff') note = PLAYOFF_PENDING_COPY
        else if (settings.schedule_mode === 'total_points') note = TOTAL_POINTS_WEEK_COPY
        else note = NO_ROWS_COPY
      }
      return { week: w.week, status: w.status, kind, median_score: w.median_score, rows, note }
    })
}

/** §16.5.4's badge vocabulary for a week's status. */
export function weekStatusBadge(status: string): { label: string; variant: 'stroke' | 'green' | 'yellow' | 'black' } {
  switch (status) {
    case 'live':
      return { label: 'Live', variant: 'green' }
    case 'correction_window':
      return { label: 'Final (pending corrections)', variant: 'yellow' }
    case 'final':
      return { label: 'Final', variant: 'black' }
    default:
      return { label: 'Upcoming', variant: 'stroke' }
  }
}

/** A score cell: pending is a dash, never `0.00` by coercion (E61). */
export function formatScore(score: number | null, status: string): string {
  if (status === 'scheduled') return '—'
  if (score === null) return 'pending'
  return score.toFixed(2)
}

/** The ladder-derived HINT that a reason will be asked for: the league's
 *  first week has left `upcoming` (116 flips it at `starts_at`). A hint
 *  only — the datum is the kickoff, which the server reads at call time
 *  (E41); the modal's copy comes from the preview's `window`. */
export const REASON_HINT_COPY =
  'Week 1 has started — a matchup edit or a remix is now a commissioner override: it is recorded and posted to the league. A reason is optional.'

export function reasonHint(weeks: readonly Pick<ScheduleWeek, 'week' | 'status'>[]): string | null {
  if (weeks.length === 0) return null
  const first = weeks.reduce((a, b) => (a.week <= b.week ? a : b))
  return first.status === 'upcoming' ? null : REASON_HINT_COPY
}

/** The teams an edit may seat: every non-retired franchise (111 refuses a
 *  retired one by name — F222). */
export function editableTeams(teams: readonly { id: string; name: string; status: string }[]): TeamRef[] {
  return teams.filter((t) => t.status !== 'retired').map((t) => ({ id: t.id, name: t.name }))
}

/** An edit that changes nothing is refused by 111 by name; the form says so
 *  before the round trip. */
export const EDIT_NO_CHANGE_COPY = 'That is the current pairing — pick a different team on one side.'
export const EDIT_SELF_COPY = 'A team cannot play itself.'

export function editFormProblem(
  row: Pick<MatchupCell, 'home' | 'away'>,
  home: string,
  away: string,
): string | null {
  if (home === away) return EDIT_SELF_COPY
  if (row.home.id === home && row.away?.id === away) return EDIT_NO_CHANGE_COPY
  return null
}

// ---------------------------------------------------------------------------
// The Remix modal — D290's two copies, the frozen-week reasons, the diff
// ---------------------------------------------------------------------------

export interface WindowCopy {
  tone: 'accent' | 'caution'
  title: string
  body: string
}

export const FREE_WINDOW_TITLE = 'Free remix'
export const OVERRIDE_WINDOW_TITLE = 'Commissioner override'

/**
 * D290 / E41's two states, BOTH rendered from the server's `window.free`:
 * before the league's Week 1 kickoff a remix is free; after it, an audited
 * override. A reason is OPTIONAL in both (Q66) — offered after kickoff,
 * posted with the change when given, never demanded. The kickoff
 * shown is the server's datum (`window.first_kickoff_at`), pre-formatted by
 * the caller (viewer-local, league zone on hover — §16.4).
 */
export function remixWindowCopy(window: WindowFlags, firstKickoffLocal: string | null): WindowCopy {
  if (window.free) {
    return {
      tone: 'accent',
      title: FREE_WINDOW_TITLE,
      body: `Week 1 hasn’t kicked off${firstKickoffLocal ? ` (first game ${firstKickoffLocal})` : ''} — a remix needs no reason. The change is posted to league chat.`,
    }
  }
  return {
    tone: 'caution',
    title: OVERRIDE_WINDOW_TITLE,
    body: `Week 1 kicked off${firstKickoffLocal ? ` ${firstKickoffLocal}` : ''} — this remix is an audited commissioner override: it is recorded and posted to league chat. A reason is optional — if you give one, it is posted with the change.`,
  }
}

const FROZEN_REASONS: Record<string, string> = {
  week_live: 'is live',
  week_final: 'is final',
  week_correction_window: 'is in its correction window',
  week_kicked_off: 'has already kicked off',
  matchup_not_scheduled: 'has a matchup under way or done',
  matchup_overridden_or_scored: 'has a scored or commissioner-set matchup',
}

export function frozenWeekCopy(frozen: RemixFrozenWeek): string {
  const why = FROZEN_REASONS[frozen.reason] ?? frozen.reason
  return `Week ${frozen.week} ${why} — kept as is.`
}

/** The diff reducer: 111's lines, grouped per week in week order, each
 *  group carrying the server's sentences. `secondary` lines keep their own
 *  group so the "(second game)" reading survives. */
export interface DiffGroup {
  week: number
  round_type: string
  lines: RemixDiffLine[]
}

export function diffByWeek(diff: readonly RemixDiffLine[]): DiffGroup[] {
  const groups = new Map<string, DiffGroup>()
  for (const line of diff) {
    const key = `${line.week}:${line.round_type}`
    const group = groups.get(key) ?? { week: line.week, round_type: line.round_type, lines: [] }
    group.lines.push(line)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => a.week - b.week || a.round_type.localeCompare(b.round_type))
}

export type PairingState = 'same' | 'flipped' | 'changed'

export interface PairingCell {
  round_type: string
  text: string
  state: PairingState
}

export interface SideBySideWeek {
  week: number
  regenerated: boolean
  current: PairingCell[]
  proposed: PairingCell[]
}

function pairingKey(roundType: string, home: string, away: string | null): string {
  const [a, b] = [home, away ?? ''].sort()
  return `${roundType}:${a}:${b}`
}

function pairingText(home: string, away: string | null, names: ReadonlyMap<string, string>): string {
  const h = names.get(home) ?? 'Unknown team'
  return away ? `${h} vs ${names.get(away) ?? 'Unknown team'}` : `${h} — bye`
}

/**
 * The side-by-side: for every week 111 proposed, the current pairings and
 * the proposed ones, each cell marked `same` (the pairing and its sides
 * survive), `flipped` (same two teams, home and away swapped) or `changed`
 * (a pairing that does not exist on the other side). Weeks 111 froze come
 * back `regenerated: false` with both columns identical.
 */
export function sideBySide(
  current: readonly ScheduleMatchup[],
  proposed: readonly RemixProposedRow[],
  names: ReadonlyMap<string, string>,
): SideBySideWeek[] {
  const weeks = new Map<number, { current: ScheduleMatchup[]; proposed: RemixProposedRow[] }>()
  const bucket = (week: number) => {
    const b = weeks.get(week) ?? { current: [], proposed: [] }
    weeks.set(week, b)
    return b
  }
  for (const p of proposed) bucket(p.week).proposed.push(p)
  for (const c of current) if (weeks.has(c.week)) bucket(c.week).current.push(c)

  const sideOf = (rows: readonly { round_type: string; home_team_id: string; away_team_id: string | null }[]) =>
    new Map(rows.map((r) => [pairingKey(r.round_type, r.home_team_id, r.away_team_id), r.home_team_id]))

  return [...weeks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([week, b]) => {
      const cur = sideOf(b.current)
      const pro = sideOf(b.proposed)
      const cell = (
        r: { round_type: string; home_team_id: string; away_team_id: string | null },
        other: Map<string, string>,
      ): PairingCell => {
        const key = pairingKey(r.round_type, r.home_team_id, r.away_team_id)
        const otherHome = other.get(key)
        const state: PairingState = otherHome === undefined ? 'changed' : otherHome === r.home_team_id ? 'same' : 'flipped'
        return { round_type: r.round_type, text: pairingText(r.home_team_id, r.away_team_id, names), state }
      }
      const order = (x: PairingCell, y: PairingCell) => x.round_type.localeCompare(y.round_type) || x.text.localeCompare(y.text)
      return {
        week,
        regenerated: b.proposed.some((p) => p.regenerated),
        current: b.current.map((r) => cell(r, pro)).sort(order),
        proposed: b.proposed.map((r) => cell(r, cur)).sort(order),
      }
    })
}

/** The system-post PREVIEW — the same sentence 111 composes at confirm
 *  (111:741–747), with the actor named by the caller. Labelled a preview on
 *  screen; after the confirm the result's own `system_post` is rendered
 *  verbatim in its place. */
/** The ONE flag the modal's decisions read — nothing else of the window.
 *  `reason_required` is deliberately NOT in this type (F363(c)): no decision
 *  here may depend on it. */
export type WindowFlags = Pick<RemixPreview['window'], 'free'>

export function systemPostPreview(
  plan: Pick<RemixPreview, 'weeks_regenerable' | 'regular_season_weeks' | 'change_count'> & { window: WindowFlags },
  reason: string,
  actorName: string,
): string {
  const weeks = plan.weeks_regenerable.join(', ')
  const head = `Schedule remixed by ${actorName}: ${plan.weeks_regenerable.length} of ${plan.regular_season_weeks} regular-season weeks regenerated (weeks ${weeks}), ${plan.change_count} team-week pairings changed`
  if (plan.window.free) return `${head}.`
  // 131's clause is CONDITIONAL (131:3608-3610): no reason ⇒ no "— reason:" tail.
  const given = reason.trim()
  return `${head} — after Week 1 kickoff (commissioner override)${given ? ` — reason: ${given}` : ''}`
}

export const NO_CHANGES_COPY = 'This seed changes nothing — roll again for a different season.'
export const NOTHING_REGENERABLE_COPY = 'Every week is frozen — nothing left to remix this season.'

/** Whether Confirm is enabled, and why not — decided from the server's plan,
 *  never from a clock and NEVER from the reason (Q66: an empty reason blocks
 *  nothing — F363(c) / R1056). */
export function confirmGate(
  plan: Pick<RemixPreview, 'no_changes' | 'weeks_regenerable'> | null,
): { ok: true } | { ok: false; why: string } {
  if (!plan) return { ok: false, why: 'Preview a remix first.' }
  if (plan.weeks_regenerable.length === 0) return { ok: false, why: NOTHING_REGENERABLE_COPY }
  if (plan.no_changes) return { ok: false, why: NO_CHANGES_COPY }
  return { ok: true }
}
