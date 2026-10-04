/**
 * League settings — the index → detail layout (Chris's Claude Design
 * prototype, TeamView.jsx `SETTING_ROWS` / `SettingsRow` / `SubHead`;
 * League Settings build, Chris 2026-10-04).
 *
 * Pure: which sections exist, how the URL names them (`?section=`), and the
 * one-line summary each index row shows — built from the league's REAL
 * stored settings, never from the prototype's sample numbers.
 */
import { deriveRosterSize, type LeagueSettings } from '@/lib/leagues/settings/league-settings'

export const SETTINGS_SECTIONS = ['teams', 'league', 'scoring', 'roster', 'draft', 'waivers'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const SECTION_TITLES: Record<SettingsSection, string> = {
  teams: 'Teams & members',
  league: 'Season & playoffs',
  scoring: 'Scoring',
  roster: 'Roster & lineups',
  draft: 'Draft',
  waivers: 'Waivers & trades',
}

/** `?section=` → a known section, or null (the index). Unknown values fall
 *  back to the index rather than an empty page. */
export function parseSettingsSection(raw: string | string[] | null | undefined): SettingsSection | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  return v && (SETTINGS_SECTIONS as readonly string[]).includes(v) ? (v as SettingsSection) : null
}

export function settingsHref(leagueId: string, section: SettingsSection | null = null): string {
  const base = `/app/leagues/${leagueId}/settings`
  return section ? `${base}?section=${section}` : base
}

export interface IndexRow {
  section: SettingsSection
  title: string
  note: string
  chips: string[]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const WAIVER_LABEL: Record<LeagueSettings['waiver_type'], string> = {
  faab: 'FAAB bidding',
  rolling_priority: 'Rolling priority',
  reverse_standings: 'Reverse standings',
  none_fcfs: 'No waivers — first come, first served',
}

const DRAFT_LABEL: Record<LeagueSettings['draft']['draft_type'], string> = {
  snake: 'Snake draft',
  auction: 'Auction draft',
  linear: 'Linear draft',
}

const REVIEW_LABEL: Record<LeagueSettings['trade_review'], string> = {
  none: 'trades go through instantly',
  commissioner: 'commissioner reviews trades',
  league_vote: 'league votes on trades',
}

const DAY_SHORT: Record<string, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
}

function clock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm
  const ampm = h < 12 ? 'AM' : 'PM'
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${ampm}`
}

export interface IndexInput {
  settings: LeagueSettings
  /** Seats that have a manager (members with a user and a team). */
  filledSeats: number
  /** The scoring rulebook's name, or null while unknown. */
  scoringName: string | null
  /** True when the league scores with its own edited copy. */
  scoringCustomized: boolean
  /** Formatter for the draft instant — injected so this stays pure. */
  formatDraftAt: (iso: string) => string
}

export function indexRows(input: IndexInput): IndexRow[] {
  const s = input.settings
  const open = Math.max(0, s.team_count - input.filledSeats)
  const starters = s.roster_settings.starting_slots.reduce((sum, slot) => sum + slot.count, 0)
  const days = (s.waiver_run_days ?? []).map((d) => DAY_SHORT[d] ?? d).join(', ')

  const teamsNote = [
    plural(s.team_count, 'team'),
    open === 0 ? 'every team has a manager' : `${plural(open, 'open spot')}`,
  ].join(' · ')

  const leagueNote = [
    s.schedule_mode === 'h2h' ? 'Head-to-head' : 'Total points',
    `${s.regular_season_weeks}-week season`,
    s.playoff_teams === 0 ? 'no playoffs' : `${s.playoff_teams} playoff teams from week ${s.playoff_start_week}`,
  ].join(' · ')

  const scoringNote = input.scoringName
    ? input.scoringCustomized
      ? `Your league’s own copy of ${input.scoringName}`
      : input.scoringName
    : input.scoringCustomized
      ? 'Your league’s own custom scoring'
      : 'Scoring rulebook'

  const rosterNote = [
    plural(starters, 'starter'),
    `${s.roster_settings.bench} bench`,
    `${s.roster_settings.ir_slots.length} IR`,
    `${plural(deriveRosterSize(s.roster_settings), 'spot')} per team`,
  ].join(' · ')

  const draftNote = [
    DRAFT_LABEL[s.draft.draft_type],
    s.draft.draft_scheduled_at ? input.formatDraftAt(s.draft.draft_scheduled_at) : 'not scheduled yet',
  ].join(' · ')

  const waiverParts = [WAIVER_LABEL[s.waiver_type]]
  if (s.waiver_type !== 'none_fcfs' && days) waiverParts.push(`claims run ${days} ${clock(s.waiver_run_time)}`)
  waiverParts.push(s.trade_deadline_week === null ? 'no trade deadline' : `trade deadline week ${s.trade_deadline_week}`)
  waiverParts.push(REVIEW_LABEL[s.trade_review])

  return [
    { section: 'teams', title: SECTION_TITLES.teams, note: teamsNote, chips: [] },
    { section: 'league', title: SECTION_TITLES.league, note: leagueNote, chips: [] },
    { section: 'scoring', title: SECTION_TITLES.scoring, note: scoringNote, chips: input.scoringCustomized ? ['Custom'] : [] },
    { section: 'roster', title: SECTION_TITLES.roster, note: rosterNote, chips: [] },
    { section: 'draft', title: SECTION_TITLES.draft, note: draftNote, chips: [] },
    {
      section: 'waivers',
      title: SECTION_TITLES.waivers,
      note: waiverParts.join(' · '),
      chips: s.waiver_type === 'faab' ? ['FAAB', `$${s.faab_budget}`] : [],
    },
  ]
}
