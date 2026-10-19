/**
 * League Menu › League settings / Scoring / Playoffs on the phone (handoff
 * m-community G2; gap list §4 item 105) — the pure read model.
 *
 * The handoff draws three pages of label / value rows in 13/600 t3
 * sections. These builders fill them from the league's REAL settings
 * (`LeagueSettings`) and scoring document (the snapshot once drafted, else
 * the live rulebook — `useLeagueScoringFamily`), never the prototype's
 * sample numbers. Nothing the desktop settings page shows is dropped: the
 * General page carries every league, roster, draft, waiver and trade
 * setting; Playoffs every bracket setting and the tiebreak order; Scoring
 * every value the league pays, per-position overrides and D/ST tiers
 * included. No React, no fetch.
 */
import { PICK_TIMER_LABELS } from '@/components/leagues/draft-config-fields-ops'
import {
  SCORING_EDITOR_SECTIONS,
  dstTierTables,
  format1View,
  positionLabel,
  renderableFields,
  sectionFieldStates,
  sentenceCase,
  type ScoringDocView,
  type ScoringEditorSectionId,
} from '@/components/leagues/scoring-editor-ops'
import type { SettingsSection } from '@/components/leagues/settings-index-ops'
import { PLAYOFF_TEAMS_TOTAL_POINTS_HINT } from '@/components/leagues/settings-panel-ops'
import { SCHEDULE_ZONES, WEEKDAY_SHORT } from '@/components/leagues/waiver-claims-ops'
import { isFormat1Doc, type ScoringRulesDoc } from '@/lib/leagues/scoring/rules-doc'
import {
  derivePlayoffRounds,
  deriveRosterSize,
  TIEBREAKERS,
  type LeagueSettings,
} from '@/lib/leagues/settings/league-settings'
import type { Weekday } from '@/lib/leagues/time/waiver-schedule'

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** The three G2 pages. */
export type SettingsPage = 'general' | 'scoring' | 'playoffs'

export const PAGE_TITLES: Record<SettingsPage, string> = {
  general: 'League settings',
  scoring: 'Scoring',
  playoffs: 'Playoffs',
}

/**
 * Which phone page a `?section=` address opens. The Menu's rows already
 * point here — League settings (none), Scoring (`scoring`), Playoffs
 * (`league`, desktop's "Season & playoffs") — and every other desktop
 * section (`teams`, `roster`, `draft`, `waivers`, linked from the setup
 * checklist and the commissioner console) is a group on League settings.
 */
export function settingsPageFor(section: SettingsSection | null): SettingsPage {
  if (section === 'scoring') return 'scoring'
  if (section === 'league') return 'playoffs'
  return 'general'
}

/** The League settings group a desktop section's address lands on (the
 *  page opens scrolled to it); null opens at the top. */
export function generalGroupFor(section: SettingsSection | null): GeneralGroupId | null {
  switch (section) {
    case 'teams':
      return 'league'
    case 'roster':
      return 'roster'
    case 'draft':
      return 'draft'
    case 'waivers':
      return 'waivers'
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** One row: a label and its value; or a list of @handles (each a profile
 *  link); or a door to another page (a chevron, its value optional). */
export type SettingsRow =
  | { key: string; label: string; value: string }
  | { key: string; label: string; handles: string[] }
  | { key: string; label: string; value?: string; href: string }

export interface SettingsGroup<Id extends string = string> {
  id: Id
  title: string
  rows: SettingsRow[]
}

export type GeneralGroupId = 'league' | 'roster' | 'draft' | 'waivers'

const onOff = (on: boolean) => (on ? 'On' : 'Off')
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "3:00 AM" from a stored "03:00". */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** "Eastern" for the zones the waiver editor offers, else the zone's own
 *  name in words ("America/Boise" → "Boise"). */
export function zoneWords(zone: string): string {
  const known = SCHEDULE_ZONES.find((z) => z.value === zone)
  if (known) return known.label
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ')
}

/** "QB, 2 RB, 2 WR, TE, FLEX, K, D/ST" — the starting slots, as the
 *  handoff writes them (a slot's eligibility note in brackets is left off:
 *  "FLEX (W/R/T)" reads "FLEX"). */
export function startersLine(slots: LeagueSettings['roster_settings']['starting_slots']): string {
  const parts = slots
    .filter((slot) => slot.count > 0)
    .map((slot) => {
      const name = slot.label.replace(/\s*\(.*\)\s*$/, '')
      return slot.count > 1 ? `${slot.count} ${name}` : name
    })
  return parts.length > 0 ? parts.join(', ') : 'None'
}

const WAIVER_TYPE: Record<LeagueSettings['waiver_type'], string> = {
  faab: 'FAAB',
  rolling_priority: 'Rolling priority',
  reverse_standings: 'Reverse standings',
  none_fcfs: 'None — first come, first served',
}

/** The handoff's "FAAB · $200 budget"; the other types by name. */
export function waiverTypeLine(s: Pick<LeagueSettings, 'waiver_type' | 'faab_budget'>): string {
  return s.waiver_type === 'faab' ? `FAAB · $${s.faab_budget} budget` : WAIVER_TYPE[s.waiver_type]
}

/** "Wed 3:00 AM Eastern" — when claims run (the handoff's "Waivers
 *  process"). */
export function waiverRunLine(s: Pick<LeagueSettings, 'waiver_run_days' | 'waiver_run_time' | 'waiver_time_zone'>): string {
  const days = s.waiver_run_days.length === 7 ? 'Every day' : s.waiver_run_days.map((d) => WEEKDAY_SHORT[d as Weekday] ?? d).join(', ')
  return `${days} ${clock12(s.waiver_run_time)} ${zoneWords(s.waiver_time_zone)}`
}

export function freeAgencyLine(
  s: Pick<LeagueSettings, 'free_agency_opens' | 'free_agency_open_day' | 'free_agency_open_time' | 'waiver_time_zone'>,
): string {
  switch (s.free_agency_opens) {
    case 'after_waiver_run':
      return 'After each waiver run'
    case 'day_and_time':
      return `${WEEKDAY_SHORT[s.free_agency_open_day as Weekday] ?? s.free_agency_open_day} ${clock12(s.free_agency_open_time)} ${zoneWords(s.waiver_time_zone)}`
    case 'never':
      return 'Never — claims only'
  }
}

/** "1 day", "2 days", "12 hours", "No wait". */
export function hoursLine(hours: number): string {
  if (hours <= 0) return 'No wait'
  if (hours % 24 === 0) return plural(hours / 24, 'day')
  return plural(hours, 'hour')
}

/** The handoff's "Commissioner · 1 day"; "None — trades go through at
 *  once" without a review. */
export function tradeReviewLine(s: Pick<LeagueSettings, 'trade_review' | 'trade_review_period_hours'>): string {
  if (s.trade_review === 'none') return 'None — trades go through at once'
  const who = s.trade_review === 'commissioner' ? 'Commissioner' : 'League vote'
  return `${who} · ${hoursLine(s.trade_review_period_hours)}`
}

const DRAFT_TYPE: Record<LeagueSettings['draft']['draft_type'], string> = { snake: 'Snake', auction: 'Auction', linear: 'Linear' }
const DRAFT_ORDER: Record<LeagueSettings['draft']['draft_order_mode'], string> = {
  random: 'Random',
  manual: 'Commissioner sets',
  custom: 'Saved order',
}
const NOMINATION_ORDER: Record<LeagueSettings['draft']['nomination_order_mode'], string> = {
  same_as_draft_order: 'Same as draft order',
  random: 'Random',
  manual: 'Commissioner sets',
}
const TRADE_LOCK: Record<LeagueSettings['trade_lock_behavior'], string> = {
  defer: 'Defer to next lock-free',
  reject: 'Reject the trade',
}

const seconds = (n: number) => (n === 0 ? 'Off' : plural(n, 'second'))
const limit = (v: 'unlimited' | number) => (v === 'unlimited' ? 'Unlimited' : String(v))

export interface GeneralInput {
  name: string
  season: number
  settings: LeagueSettings
  members: ReadonlyArray<{ user_id: string | null; team_id: string | null; role: string; profiles: { username: string } | null }>
  /** The draft instant as words — injected so this stays pure. */
  formatDraftAt: (iso: string) => string
  /** Members door (the Members page), or null to leave it off. */
  membersHref: string | null
}

/** League settings (handoff G2 "general"): League, Roster, Draft, and
 *  Waivers & trades — every setting desktop's settings page holds outside
 *  Scoring and Playoffs. */
export function generalGroups(input: GeneralInput): SettingsGroup<GeneralGroupId>[] {
  const s = input.settings
  const filled = input.members.filter((m) => m.user_id !== null && m.team_id !== null).length
  const open = Math.max(0, s.team_count - filled)
  const handles = (role: string) =>
    input.members.filter((m) => m.role === role && m.profiles?.username).map((m) => m.profiles!.username)
  const commissioners = handles('commissioner')
  const cos = handles('co_commissioner')

  const league: SettingsRow[] = [
    { key: 'name', label: 'League name', value: input.name },
    { key: 'teams', label: 'Teams', value: open > 0 ? `${s.team_count} · ${plural(open, 'open spot')}` : String(s.team_count) },
    commissioners.length > 0 ? { key: 'commissioner', label: 'Commissioner', handles: commissioners } : { key: 'commissioner', label: 'Commissioner', value: '—' },
    ...(cos.length > 0 ? [{ key: 'co', label: cos.length === 1 ? 'Co-commissioner' : 'Co-commissioners', handles: cos }] : []),
    { key: 'season', label: 'Season', value: String(input.season) },
    { key: 'schedule', label: 'Schedule', value: s.schedule_mode === 'h2h' ? 'Head-to-head' : 'Total points' },
    { key: 'regular', label: 'Regular season', value: plural(s.regular_season_weeks, 'week') },
    { key: 'median', label: 'Median game', value: onOff(s.median_game) },
    { key: 'second', label: 'Second opponent', value: onOff(s.second_opponent) },
    ...(input.membersHref ? [{ key: 'members', label: 'Members', href: input.membersHref }] : []),
  ]

  const r = s.roster_settings
  const roster: SettingsRow[] = [
    { key: 'starters', label: 'Starters', value: startersLine(r.starting_slots) },
    { key: 'bench', label: 'Bench', value: String(r.bench) },
    { key: 'ir', label: 'IR', value: String(r.ir_slots.length) },
    { key: 'size', label: 'Roster spots', value: `${deriveRosterSize(r)} per team` },
    { key: 'lock', label: 'Lineup lock', value: 'Each player’s kickoff' },
    { key: 'illegal', label: 'Allow illegal lineups', value: onOff(s.allow_illegal_lineups) },
    { key: 'autosub', label: 'Auto-sub inactives', value: onOff(s.auto_sub_inactives) },
    { key: 'corrections', label: 'Stat corrections', value: 'Until next week’s first game' },
  ]

  const d = s.draft
  const draft: SettingsRow[] = [
    { key: 'type', label: 'Draft type', value: DRAFT_TYPE[d.draft_type] },
    ...(d.draft_type === 'snake' ? [{ key: 'reversal', label: 'Third-round reversal', value: onOff(d.snake_reversal) }] : []),
    { key: 'when', label: 'Draft time', value: d.draft_scheduled_at ? input.formatDraftAt(d.draft_scheduled_at) : 'Not set' },
    ...(d.time_zone ? [{ key: 'zone', label: 'League time zone', value: zoneWords(d.time_zone) }] : []),
    { key: 'order', label: 'Draft order', value: DRAFT_ORDER[d.draft_order_mode] },
    { key: 'clock', label: 'Pick clock', value: PICK_TIMER_LABELS[d.pick_timer_seconds] ?? seconds(d.pick_timer_seconds) },
    ...(d.draft_type === 'auction'
      ? [
          { key: 'budget', label: 'Auction budget', value: `$${d.auction_budget}` },
          { key: 'zero', label: 'Allow $0 nominations', value: onOff(d.auction_zero_dollar_nominations) },
          { key: 'nom', label: 'Nomination clock', value: seconds(d.auction_nomination_seconds) },
          { key: 'bid', label: 'Bid clock', value: seconds(d.auction_bid_seconds) },
          { key: 'snipe', label: 'Anti-snipe', value: seconds(d.auction_anti_snipe_seconds) },
          { key: 'nomorder', label: 'Nomination order', value: NOMINATION_ORDER[d.nomination_order_mode] },
        ]
      : []),
  ]

  const faab = s.waiver_type === 'faab'
  const waivers: SettingsRow[] = [
    { key: 'type', label: 'Waiver type', value: waiverTypeLine(s) },
    ...(s.waiver_type !== 'none_fcfs'
      ? [
          { key: 'runs', label: 'Waivers process', value: waiverRunLine(s) },
          { key: 'fa', label: 'Free agency opens', value: freeAgencyLine(s) },
        ]
      : []),
    ...(faab
      ? [
          { key: 'min', label: 'Minimum bid', value: `$${s.faab_min_bid}` },
          { key: 'tie', label: 'Bid tiebreaker', value: s.faab_tiebreaker === 'rolling_priority' ? 'Rolling priority' : 'Reverse standings' },
        ]
      : []),
    { key: 'week', label: 'Acquisitions per week', value: limit(s.acquisitions_per_week) },
    { key: 'season', label: 'Acquisitions per season', value: limit(s.acquisitions_per_season) },
    { key: 'hold', label: 'Free agent hold', value: s.fa_hold_hours > 0 ? plural(s.fa_hold_hours, 'hour') : 'None' },
    { key: 'review', label: 'Trade review', value: tradeReviewLine(s) },
    ...(s.trade_review === 'league_vote' ? [{ key: 'veto', label: 'Votes to veto', value: String(s.trade_veto_votes) }] : []),
    { key: 'deadline', label: 'Trade deadline', value: s.trade_deadline_week === null ? 'None' : `Week ${s.trade_deadline_week}` },
    ...(faab ? [{ key: 'faabtrades', label: 'FAAB in trades', value: onOff(s.allow_faab_in_trades) }] : []),
    { key: 'future', label: 'Future considerations', value: onOff(s.allow_future_considerations) },
    { key: 'live', label: 'If a game is live', value: TRADE_LOCK[s.trade_lock_behavior] },
  ]

  return [
    { id: 'league', title: 'League', rows: league },
    { id: 'roster', title: 'Roster', rows: roster },
    { id: 'draft', title: 'Draft', rows: draft },
    { id: 'waivers', title: 'Waivers & trades', rows: waivers },
  ]
}

// ---------------------------------------------------------------------------
// Playoffs
// ---------------------------------------------------------------------------

const TIEBREAK_NAME: Record<string, string> = {
  win_pct: 'Record',
  points_for: 'Points for',
  head_to_head: 'Head-to-head',
  points_against: 'Points against',
  coin_flip: 'Coin flip',
}

/**
 * The league's tiebreak order in words — the stored chain, then any entry
 * it leaves out in the catalog's order (so it is always whole, as the
 * standings read builds it). Divisions are left out (cut from v1, so that
 * entry never separates anyone), head-to-head too in a total-points league
 * (no head-to-head games); a coin flip ends every tie, so nothing after it.
 */
export function tiebreakOrder(s: Pick<LeagueSettings, 'tiebreakers' | 'schedule_mode'>): string[] {
  const order: string[] = []
  for (const e of [...s.tiebreakers, ...TIEBREAKERS]) if (!order.includes(e)) order.push(e)
  const out: string[] = []
  for (const e of order) {
    if (e === 'division_record' || (e === 'head_to_head' && s.schedule_mode !== 'h2h')) continue
    const name = TIEBREAK_NAME[e]
    if (!name) continue
    out.push(name)
    if (e === 'coin_flip') break
  }
  return out
}

/** "15, 16, 17" — each playoff round's week(s); a two-week round reads
 *  "15–16". */
export function playoffWeekList(s: Pick<LeagueSettings, 'playoff_teams' | 'playoff_start_week' | 'playoff_weeks_per_round'>): string {
  const rounds = derivePlayoffRounds(s.playoff_teams)
  const parts: string[] = []
  for (let r = 0; r < rounds; r++) {
    const first = s.playoff_start_week + r * s.playoff_weeks_per_round
    const last = first + s.playoff_weeks_per_round - 1
    parts.push(first === last ? String(first) : `${first}–${last}`)
  }
  return parts.join(', ')
}

/** Top seeds that skip round 1 — the bracket is the next power of two
 *  (§7.3.1 `playoff_byes`: derived). */
export function playoffByes(playoffTeams: number): number {
  const rounds = derivePlayoffRounds(playoffTeams)
  return rounds === 0 ? 0 : 2 ** rounds - playoffTeams
}

export interface PlayoffsPage {
  groups: SettingsGroup<'format' | 'other' | 'tiebreakers'>[]
  /** The b1 note under the rows (the handoff's bracket line). */
  note: string
}

export function playoffsPage(s: LeagueSettings): PlayoffsPage {
  const ties = tiebreakOrder(s)
  const tiebreakers: SettingsGroup<'tiebreakers'> = {
    id: 'tiebreakers',
    title: 'Tiebreakers',
    rows: ties.map((name, i) => ({ key: `tb-${i}`, label: ordinal(i + 1), value: name })),
  }
  if (s.playoff_teams <= 0) {
    return {
      groups: [{ id: 'format', title: 'Format', rows: [{ key: 'teams', label: 'Playoff teams', value: 'None' }] }, tiebreakers],
      note:
        s.schedule_mode === 'total_points'
          ? PLAYOFF_TEAMS_TOTAL_POINTS_HINT
          : 'Playoffs are off for this league — the final standings decide the champion.',
    }
  }
  const byes = playoffByes(s.playoff_teams)
  const [first, second] = ties
  return {
    groups: [
      {
        id: 'format',
        title: 'Format',
        rows: [
          { key: 'teams', label: 'Playoff teams', value: String(s.playoff_teams) },
          { key: 'weeks', label: 'Weeks', value: playoffWeekList(s) },
          { key: 'byes', label: 'First-round byes', value: byes > 0 ? `Top ${plural(byes, 'seed')}` : 'None' },
          { key: 'seeding', label: 'Seeding', value: first && second ? `${first}, then ${second.toLowerCase()}` : (first ?? 'Record') },
        ],
      },
      {
        id: 'other',
        title: 'Other',
        rows: [
          { key: 'round', label: 'Weeks per round', value: plural(s.playoff_weeks_per_round, 'week') },
          { key: 'consolation', label: 'Consolation bracket', value: onOff(s.consolation_bracket) },
          { key: 'reseed', label: 'Reseed each round', value: onOff(s.playoff_reseed) },
          { key: 'third', label: 'Third-place game', value: onOff(s.third_place_game) },
        ],
      },
      tiebreakers,
    ],
    note: `The playoff bracket shows at the top of the League tab once the playoffs start in Week ${s.playoff_start_week}.`,
  }
}

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** A point value as the handoff prints it: "4", "0.5", "−2" (a true minus). */
export function pointsValue(n: number): string {
  const text = String(Number(n.toFixed(4)))
  return n < 0 ? `−${text.slice(1)}` : text
}

const YARD_KEYS = new Set(['pass_yards', 'rush_yards', 'receiving_yards'])

/** A coefficient as words: yards read "1 pt per 25" (the handoff's), every
 *  other stat its points. */
export function coefficientLine(key: string, c: number): string {
  if (YARD_KEYS.has(key) && c > 0) {
    const per = 1 / c
    if (Math.abs(per - Math.round(per)) < 1e-6) return `1 pt per ${Math.round(per)}`
    return `${pointsValue(c)} per yard`
  }
  return pointsValue(c)
}

/** The page's section order (the handoff's Passing → … → Defense), over
 *  the scoring editor's own catalog — never a second list of stats. */
const SECTION_ORDER: ReadonlyArray<{ id: ScoringEditorSectionId; title: string }> = [
  { id: 'passing', title: 'Passing' },
  { id: 'rushing', title: 'Rushing' },
  { id: 'receiving', title: 'Receiving' },
  { id: 'turnovers', title: 'Turnovers' },
  { id: 'special_teams', title: 'Special teams' },
  { id: 'kicking', title: 'Kicking' },
  { id: 'dst_events', title: 'Defense' },
]

/**
 * Every value the league pays, by section. A value set for one position
 * only (a custom league's per-position override) is its own row under the
 * shared one ("Receptions (TE)"); a stat the league doesn't score has no
 * row. The D/ST points- and yards-allowed tiers follow Defense. Takes a
 * document already parsed by the rules-doc schema (the screen parses, and
 * says so when it can't, instead of showing nothing).
 */
export function scoringGroups(doc: ScoringRulesDoc): SettingsGroup[] {
  const view: ScoringDocView = isFormat1Doc(doc) ? format1View(doc) : { base: doc.base, positions: doc.positions }
  const groups: SettingsGroup[] = []
  for (const { id, title } of SECTION_ORDER) {
    const section = SCORING_EDITOR_SECTIONS.find((sec) => sec.id === id)
    if (!section) continue
    const rows: SettingsRow[] = []
    if (section.positions.length === 1) {
      // K and D/ST: their one page's values (what a fork's edits write).
      for (const field of sectionFieldStates(view, id, section.positions[0])) {
        if (field.value !== undefined) rows.push({ key: field.key, label: sentenceCase(field.label), value: coefficientLine(field.key, field.value) })
      }
    } else {
      for (const field of renderableFields(section)) {
        const base = Object.prototype.hasOwnProperty.call(view.base, field.key) ? view.base[field.key] : undefined
        if (base !== undefined) rows.push({ key: field.key, label: sentenceCase(field.label), value: coefficientLine(field.key, base) })
        for (const p of section.positions) {
          const own = view.positions[p]
          if (own && Object.prototype.hasOwnProperty.call(own, field.key)) {
            rows.push({
              key: `${field.key}:${p}`,
              label: `${sentenceCase(field.label)} (${positionLabel(p)})`,
              value: coefficientLine(field.key, own[field.key]),
            })
          }
        }
      }
    }
    if (rows.length > 0) groups.push({ id, title, rows })
  }
  for (const table of dstTierTables(doc)) {
    // "0 points", "1–6 points", "550+ yards" — the range with its unit.
    const unit = table.family === 'def_pa' ? 'points' : 'yards'
    const rows = table.rows.flatMap((row) =>
      row.payout === undefined ? [] : [{ key: row.key, label: `${row.label} ${unit}`, value: pointsValue(row.payout) }],
    )
    if (rows.length > 0) groups.push({ id: table.family, title: table.title, rows })
  }
  return groups
}
