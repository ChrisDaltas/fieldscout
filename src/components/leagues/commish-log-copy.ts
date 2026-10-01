/**
 * The commissioner log in plain words — M6 task L.E1.34 (tasks-M6 TD12: "one
 * activity renderer, no code words"; spec §10.3, §12.12; PROGRESS D459,
 * F512 / F516 / F518).
 *
 * `activity-feed-ops.ts` is still THE renderer (League Home, the Activity
 * page and the console's recent list all read `commishLogLines`); this module
 * is the vocabulary it reads:
 *
 *  - `COMMISH_ACTION_WORDS` — every `action_type` a receipt can carry (the
 *    §12.12 vocabulary and every literal the migrations write — the census,
 *    `commish-log-copy.test.ts`, enumerates both and fails BY NAME for one
 *    with no words) → the sentence a member reads when the receipt carries no
 *    more detail than its type. The old `replace(/_/g, ' ')` fallback is
 *    retired: an `action_type` newer than this file reads as
 *    `UNKNOWN_ACTION_WORDS`, never as its code name.
 *  - `SETTING_WORDS` — every league-setting key a settings receipt can name
 *    (`leagueSettingsSchema`'s keys, the typed columns 169's settings document
 *    adds, the retired waiver keys an old receipt can hold) → its words, and
 *    `settingValueWords` for the values (an enum value in words, a boolean as
 *    on / off, never `[object Object]`, never "null").
 *  - `receiptDetail` — the fuller sentence for a receipt whose before / after
 *    shape this file knows (D449(4), D450(3)–(4), D452(3), 134, 145), read
 *    from the stored documents, never from a verb's name.
 *
 * Nothing here names an invite's token, email or username, a blind bid or a
 * queue's players (TD9 — the receipts never carry them; the words never ask
 * for them).
 */
import { STAT_KEYS } from '@/lib/leagues/stats/stat-keys'
import { sentenceLabel } from '@/lib/leagues/scoring/stat-correction-labels'

// ---------------------------------------------------------------------------
// Every action type → its words (the census target)
// ---------------------------------------------------------------------------

/** What a receipt of each type says when nothing more can be read from it. */
export const COMMISH_ACTION_WORDS: Readonly<Record<string, string>> = {
  // Scores, results, the schedule and the bracket (126 / 130 / 131 / 134 / 135 / 161).
  edit_score: 'corrected a matchup score',
  set_result: 'set a matchup result',
  edit_standings: 'changed the standings',
  edit_schedule: 'changed the schedule',
  edit_bracket: 'changed a playoff matchup',
  reopen_week: 'reopened a week',
  rescore_final_week: 're-scored a week after it was final',
  // Rosters and lineups (123 / 127 / 128 / 139 / 147).
  edit_lineup: 'set a team’s lineup',
  move_player: 'moved a player to another team',
  force_add: 'added a player to a team',
  force_drop: 'dropped a player from a team',
  reassign_team: 'changed a team’s name',
  set_autopilot: 'changed a team’s autopilot',
  edit_faab: 'changed a team’s FAAB balance',
  // Waiver claims made for a team (145 / 150).
  submit_waiver_claim: 'put in a waiver claim for a team',
  edit_waiver_claim: 'changed a team’s waiver claim',
  cancel_waiver_claim: 'cancelled a team’s waiver claim',
  reorder_waiver_claims: 'reordered a team’s waiver claims',
  // Trades (148 / 151 / 156).
  propose_trade: 'offered a trade',
  accept_trade: 'accepted a trade',
  reject_trade: 'turned down a trade',
  cancel_trade: 'called off a trade offer',
  counter_trade: 'made a counter-offer',
  approve_trade: 'approved a trade',
  veto_trade: 'vetoed a trade',
  force_trade: 'forced a trade through',
  reverse_trade: 'reversed a trade',
  // The draft room (168 / 171).
  draft_create: 'set up the draft',
  draft_start: 'started the draft',
  draft_pause: 'paused the draft',
  draft_resume: 'resumed the draft',
  draft_set_clock: 'changed the draft clock',
  draft_set_order: 'changed the draft order',
  draft_undo: 'undid the last draft pick',
  draft_reassign: 'gave a draft pick to another team',
  draft_move_player: 'moved a drafted player to another team',
  draft_force_pick: 'made a draft pick for a team',
  draft_reverse_bid: 'reversed a winning auction bid',
  draft_adjust_budget: 'changed a team’s draft budget',
  draft_cancel_nomination: 'cancelled the player up for auction',
  draft_bid: 'bid for a team in the auction',
  draft_set_queue: 'changed a team’s draft targets',
  draft_end: 'ended the draft',
  draft_reset: 'reset the draft',
  set_autodraft: 'changed a team’s autodraft',
  // Members and invites (169).
  add_seat: 'added a team to the league',
  assign_manager: 'gave a team a manager',
  replace_manager: 'replaced a team’s manager',
  retire_franchise: 'retired a team', // history only — no verb writes it since 176 (L.E1.42); an old receipt still reads
  vacate_seat: 'removed a team’s manager',
  promote_member: 'made a member a co-commissioner',
  demote_member: 'removed a co-commissioner',
  transfer_commissioner: 'handed the commissioner role to another member',
  create_invite: 'created an invite',
  resend_invite: 're-sent an invite',
  revoke_invite: 'cancelled an invite',
  rotate_invite_code: 'made a new league invite code',
  set_invite_slug: 'changed the league’s invite link',
  // League setup (129 / 169).
  change_setting: 'changed a league setting',
  change_settings: 'changed the league settings',
  edit_scoring: 'changed the scoring rules',
  fork_scoring: 'switched the league to custom scoring',
  edit_league_profile: 'changed the league’s name or picture',
  lifecycle_change: 'moved the league to its next stage',
  delete_league: 'deleted the league',
}

/** A receipt whose type is newer than this file — plain words, never its code name. */
export const UNKNOWN_ACTION_WORDS = 'made a commissioner change'

/** The words for one action type (the census reads this). */
export function actionWords(actionType: string): string {
  return COMMISH_ACTION_WORDS[actionType] ?? UNKNOWN_ACTION_WORDS
}

// ---------------------------------------------------------------------------
// Every setting key → its words; values in words
// ---------------------------------------------------------------------------

/** A league setting's name as it follows "changed the …". */
export const SETTING_WORDS: Readonly<Record<string, string>> = {
  format: 'league format',
  team_count: 'number of teams',
  divisions: 'number of divisions',
  regular_season_weeks: 'regular season length',
  playoff_teams: 'number of playoff teams',
  playoff_start_week: 'playoffs start week',
  playoff_weeks_per_round: 'weeks per playoff round',
  playoff_byes: 'playoff byes',
  playoff_reseed: 'playoff reseeding',
  consolation_bracket: 'consolation bracket',
  third_place_game: 'third-place game',
  schedule_mode: 'scoring format',
  median_game: 'median game',
  second_opponent: 'second game each week',
  schedule_seed: 'schedule',
  roster_settings: 'roster spots',
  waiver_type: 'waiver type',
  faab_budget: 'FAAB budget',
  faab_min_bid: 'minimum FAAB bid',
  faab_tiebreaker: 'tiebreak for equal bids',
  waiver_run_days: 'waiver days',
  waiver_run_time: 'waiver time',
  waiver_time_zone: 'waiver time zone',
  free_agency_opens: 'when free agency opens',
  free_agency_open_day: 'free agency day',
  free_agency_open_time: 'free agency time',
  acquisitions_per_week: 'pickups allowed each week',
  acquisitions_per_season: 'pickups allowed each season',
  fa_hold_hours: 'hold on dropped players',
  trade_review: 'trade review',
  trade_veto_votes: 'votes needed to veto a trade',
  trade_review_period_hours: 'trade review period',
  trade_deadline_week: 'trade deadline week',
  allow_faab_in_trades: 'FAAB in trades',
  allow_future_considerations: 'future considerations in trades',
  trade_lock_behavior: 'trades with players whose games have started',
  lineup_lock: 'lineup lock',
  allow_illegal_lineups: 'lineups that break the roster rules',
  auto_sub_inactives: 'automatic subs for inactive starters',
  stat_correction_window: 'stat correction window',
  tiebreakers: 'standings tiebreakers',
  draft: 'draft settings',
  // The typed columns 169's settings document adds over the blob.
  scoring_system_id: 'scoring system',
  // The waiver keys retired by 149 — an older receipt can still hold them.
  waiver_process_day: 'waiver day',
  waiver_process_time: 'waiver time',
  waiver_period_hours: 'waiver period',
  free_agency: 'free agency',
  bench_lock: 'bench lock',
}

/** The words for one setting key — a key newer than this file reads as "a setting". */
export function settingWords(key: string): string {
  return SETTING_WORDS[key] ?? 'a setting'
}

/** Enum values in words, by the value itself (the settings vocabulary shares them). */
export const SETTING_VALUE_WORDS: Readonly<Record<string, string>> = {
  faab: 'FAAB bidding',
  rolling_priority: 'rolling waiver order',
  reverse_standings: 'reverse standings',
  none_fcfs: 'no waivers — first come, first served',
  h2h: 'head-to-head',
  total_points: 'total points',
  none: 'no review',
  commissioner: 'the commissioner reviews',
  league_vote: 'league vote',
  defer: 'wait for the games to end',
  reject: 'refuse the trade',
  per_player_kickoff: 'each player at his kickoff',
  thu_06_00_et: 'Thursday 6:00 AM ET',
  after_waiver_run: 'after waivers run',
  day_and_time: 'at a set day and time',
  never: 'never',
  unlimited: 'unlimited',
  auto: 'automatic',
  redraft: 'redraft',
  sun: 'Sun',
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  // The standings tiebreak chain (`TIEBREAKERS`, R1395).
  win_pct: 'win percentage',
  points_for: 'points scored',
  head_to_head: 'head-to-head record',
  points_against: 'points against',
  division_record: 'division record',
  coin_flip: 'coin flip',
}

/** R1395: the keys whose number is a count of hours or weeks — said with its unit. */
const SETTING_UNITS: Readonly<Record<string, readonly [string, string]>> = {
  fa_hold_hours: ['hour', 'hours'],
  trade_review_period_hours: ['hour', 'hours'],
  waiver_period_hours: ['hour', 'hours'],
  stat_correction_window: ['hour', 'hours'],
  regular_season_weeks: ['week', 'weeks'],
}

/** One stored setting value in words: `null` is "none", a boolean on / off, an
 *  enum value its words, a list of values joined, anything structured
 *  "(updated)" — never `[object Object]`, never "null", never a code word. */
export function settingValueWords(value: unknown, key?: string): string {
  if (value === null || value === undefined) return 'none'
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'number') {
    const unit = key ? SETTING_UNITS[key] : undefined
    return unit ? `${value} ${value === 1 ? unit[0] : unit[1]}` : String(value)
  }
  if (typeof value === 'string') return SETTING_VALUE_WORDS[value] ?? (/_/.test(value) ? value.replace(/_/g, ' ') : value)
  if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')) {
    return value.length === 0 ? 'none' : value.map((v) => settingValueWords(v)).join(', ')
  }
  return '(updated)'
}

/** "the waiver type: FAAB bidding → rolling waiver order" — one changed key. */
export function settingChange(key: string, before: unknown, after: unknown): string {
  return `${settingWords(key)}: ${settingValueWords(before, key)} → ${settingValueWords(after, key)}`
}

// ---------------------------------------------------------------------------
// Scoring rules (169's edit_scoring: paths like "base.receptions",
// "positions.TE.receptions")
// ---------------------------------------------------------------------------

const STAT_WORDS: ReadonlyMap<string, string> = new Map(STAT_KEYS.map((def) => [def.key, sentenceLabel(def.label)]))
const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'DEF', 'DL', 'LB', 'DB'])

/** One scoring-rule path in words ("TE receptions"), or null when its stat has none. */
export function scoringRuleWords(path: string): string | null {
  const parts = path.split('.')
  const stat = STAT_WORDS.get(parts[parts.length - 1] ?? '')
  if (!stat) return null
  const position = parts.find((part) => POSITIONS.has(part))
  return position ? `${position} ${stat}` : stat
}

// ---------------------------------------------------------------------------
// Other value words
// ---------------------------------------------------------------------------

/** A league stage (`leagues.status`) in words. */
export const LEAGUE_STAGE_WORDS: Readonly<Record<string, string>> = {
  setup: 'setting up',
  scheduled: 'draft scheduled',
  drafting: 'drafting',
  in_season: 'in season',
  playoffs: 'playoffs',
  complete: 'season over',
}

/** A clock in seconds, in words: 0 = no clock. */
export function clockWords(seconds: unknown): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'none'
  if (seconds === 0) return 'no clock'
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`
  return `${seconds} seconds`
}

/** The draft-clock receipt's keys (168 `draft_set_clock`) → their words. */
export const DRAFT_CLOCK_WORDS: Readonly<Record<string, string>> = {
  pick_timer_seconds: 'pick clock',
  auction_nomination_seconds: 'nomination clock',
  auction_bid_seconds: 'bid clock',
  auction_anti_snipe_seconds: 'last-second bid extension',
}

// ---------------------------------------------------------------------------
// The fuller sentence for a receipt this file knows the shape of
// ---------------------------------------------------------------------------

type Doc = Record<string, unknown>
const asDoc = (value: unknown): Doc => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Doc) : {})
const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

export interface ReceiptContext {
  actionType: string
  targetId: string | null
  before: Doc
  after: Doc
  metadata: Doc
  /** A team's name by id — also records that the sentence named that team
   *  (F518: the "(for <team>)" suffix drops when the sentence already says it). */
  team: (id: unknown, fallback?: unknown) => string
  /** A member's username by user id, or null when the league detail has none. */
  member: (userId: unknown) => string | null
}

/** Several changed keys, at most three named, the rest counted. */
function listChanges(changes: string[]): string {
  if (changes.length <= 3) return changes.join('; ')
  return `${changes.slice(0, 3).join('; ')}; and ${plural(changes.length - 3, 'more change')}`
}

/** The detailed sentence per action type; `null` = fall back to its words. */
const DETAIL: Readonly<Record<string, (c: ReceiptContext) => string | null>> = {
  // ---- the draft room (168 / 171; D449(4), D452(3)) ----
  draft_set_clock: ({ before, after }) => {
    const changed = Object.keys(DRAFT_CLOCK_WORDS)
      .filter((key) => key in after && before[key] !== after[key])
      .map((key) => `${DRAFT_CLOCK_WORDS[key]}: ${clockWords(before[key])} → ${clockWords(after[key])}`)
    return changed.length > 0 ? `changed the draft clock — ${listChanges(changed)}` : null
  },
  draft_set_order: ({ before, after }) => {
    const draft = JSON.stringify(before.draft_order) !== JSON.stringify(after.draft_order)
    const nomination = JSON.stringify(before.nomination_order) !== JSON.stringify(after.nomination_order)
    if (draft && nomination) return 'changed the draft order and the nomination order'
    if (nomination) return 'changed the nomination order'
    return draft ? 'changed the draft order' : null
  },
  draft_undo: ({ metadata }) => {
    const n = num(metadata.undone_count)
    const to = num(metadata.rewound_to_pick)
    if (n === null) return null
    return `undid ${n === 1 ? 'the last draft pick' : `the last ${n} draft picks`}${to === null ? '' : ` — back to pick ${to}`}`
  },
  draft_reassign: ({ before, after, team }) => {
    const pick = num(after.pick_number)
    if (pick === null) return null
    return `gave draft pick ${pick} from ${team(before.team_id)} to ${team(after.team_id)}`
  },
  draft_move_player: ({ before, after, team }) => {
    const pick = num(after.pick_number)
    return pick === null ? null : `moved the player taken at pick ${pick} from ${team(before.team_id)} to ${team(after.team_id)}`
  },
  draft_force_pick: ({ after, metadata, team }) => {
    const pick = num(after.pick_number)
    const forTeam = team(metadata.for_team_id ?? after.team_id)
    if ('nomination' in after) return `put a player up for auction for ${forTeam}`
    return pick === null ? `made a draft pick for ${forTeam}` : `made pick ${pick} for ${forTeam}`
  },
  draft_reverse_bid: ({ before, metadata, team }) => {
    const pick = num(before.pick_number)
    const refunded = num(metadata.refunded)
    return `reversed ${team(before.team_id)}’s winning bid${pick === null ? '' : ` at pick ${pick}`}${refunded === null ? '' : ` ($${refunded} back)`}`
  },
  draft_adjust_budget: ({ targetId, metadata, team }) => {
    const delta = num(metadata.delta)
    const name = team(targetId, metadata.team_name)
    if (delta === null) return `changed ${name}’s draft budget`
    return `${delta >= 0 ? 'added' : 'took'} $${Math.abs(delta)} ${delta >= 0 ? 'to' : 'from'} ${name}’s draft budget`
  },
  draft_cancel_nomination: ({ before, team }) => {
    const by = asDoc(before.nomination).team_id
    return by ? `cancelled the player ${team(by)} put up for auction` : null
  },
  draft_end: ({ metadata }) => {
    const unfilled = num(metadata.unfilled_slots)
    return unfilled && unfilled > 0 ? `ended the draft (${plural(unfilled, 'roster spot')} left empty)` : 'ended the draft'
  },
  draft_reset: ({ metadata }) => {
    const cleared = num(metadata.picks_cleared)
    return cleared === null ? null : `reset the draft (${plural(cleared, 'pick')} cleared)`
  },
  draft_start: ({ after }) => {
    const open = Array.isArray(after.placeholder_team_ids) ? after.placeholder_team_ids.length : 0
    return open > 0 ? `started the draft (${plural(open, 'team')} with no manager — autopick drafts for ${open === 1 ? 'it' : 'them'})` : 'started the draft'
  },
  set_autodraft: ({ targetId, after, metadata, team }) =>
    typeof after.autodraft === 'boolean' ? `turned autodraft ${after.autodraft ? 'on' : 'off'} for ${team(targetId, metadata.team_name)}` : null,
  draft_bid: ({ after, metadata, team }) => {
    const amount = num(after.high_bid)
    const forTeam = team(metadata.for_team_id ?? after.high_bidder_team_id)
    return amount === null ? `bid for ${forTeam} in the auction` : `bid $${amount} for ${forTeam} in the auction`
  },
  draft_set_queue: ({ targetId, after, metadata, team }) => {
    const targets = num(after.targets)
    const name = team(targetId, metadata.team_name)
    return targets === null ? `changed ${name}’s draft targets` : `set ${name}’s draft targets (${plural(targets, 'player')})`
  },
  // ---- membership and invites (169; D450(3)) ----
  add_seat: ({ after, team }) => `added a team to the league: ${team(after.team_id, after.team_name)}`,
  assign_manager: ({ targetId, after, metadata, member, team }) => {
    const who = member(after.manager_user_id)
    const name = team(targetId, metadata.team_name)
    return who ? `made ${who} the manager of ${name}` : `gave ${name} a manager`
  },
  // F549 (D465): the three ways a commissioner removes a manager (169 / 173's
  // `remove_manager`). The removed manager is named by the log's own read
  // (`CommishLogItem.usernames`) — he is no longer in the league's members.
  replace_manager: ({ targetId, before, after, metadata, member, team }) => {
    const name = team(targetId, metadata.team_name)
    const from = member(before.manager_user_id)
    const to = member(after.manager_user_id)
    if (from && to) return `replaced ${name}’s manager: ${from} → ${to}`
    if (to) return `made ${to} the new manager of ${name}`
    if (from) return `replaced ${from} as ${name}’s manager`
    return `replaced ${name}’s manager`
  },
  // The feed's words for the same act (`retireTransactionText`), plus who
  // managed the retired team: "retired Bravo (managed by dana) — Team 9
  // takes its place from Week 6". A receipt with no week recorded (a
  // complete league) says "after the season"; one with no such key says
  // nothing about when.
  retire_franchise: ({ targetId, before, after, metadata, member, team }) => {
    const successor = after.successor_team_id ? team(after.successor_team_id, after.successor_team_name) : str(after.successor_team_name)
    const who = member(before.manager_user_id)
    const week = num(after.retired_at_week)
    const when = week !== null ? ` from Week ${week}` : 'retired_at_week' in after ? ' after the season' : ''
    return `retired ${team(targetId, metadata.team_name)}${who ? ` (managed by ${who})` : ''}${successor ? ` — ${successor} takes its place${when}` : ''}`
  },
  vacate_seat: ({ targetId, before, metadata, member, team }) => {
    const who = member(before.manager_user_id)
    const name = team(targetId, metadata.team_name)
    return `${who ? `removed ${who} as ${name}’s manager` : `removed ${name}’s manager`} — the team has no manager now`
  },
  promote_member: ({ metadata, member }) => {
    const who = member(metadata.user_id)
    return who ? `made ${who} a co-commissioner` : null
  },
  demote_member: ({ metadata, member }) => {
    const who = member(metadata.user_id)
    return who ? `removed ${who} as co-commissioner` : null
  },
  transfer_commissioner: ({ after, member }) => {
    const who = member(after.commissioner_user_id)
    return who ? `handed the commissioner role to ${who}` : null
  },
  // An invite names its seat and its kind — never who it was sent to (TD9).
  create_invite: ({ after, team }) => {
    const seat = after.target_team_id ? ` for ${team(after.target_team_id, after.team_name)}` : ''
    return after.kind === 'link' ? `made an invite link${seat}` : `sent an invite${seat}`
  },
  resend_invite: ({ metadata, team }) => (metadata.target_team_id ? `re-sent the invite for ${team(metadata.target_team_id, metadata.team_name)}` : null),
  revoke_invite: ({ metadata, team }) => (metadata.target_team_id ? `cancelled the invite for ${team(metadata.target_team_id, metadata.team_name)}` : null),
  set_invite_slug: ({ after }) => (after.invite_slug === null ? 'removed the league’s custom invite link' : 'changed the league’s custom invite link'),
  // ---- league setup (129 / 169; D450(4)) ----
  change_settings: ({ before, after }) => {
    const b = asDoc(before.settings)
    const a = asDoc(after.settings)
    const keys = Object.keys(a)
    return keys.length === 0 ? null : `changed the league settings — ${listChanges(keys.map((k) => settingChange(k, b[k], a[k])))}`
  },
  edit_scoring: ({ before, after }) => {
    const b = asDoc(before.scoring_rules)
    const a = asDoc(after.scoring_rules)
    const keys = Object.keys(a)
    if (keys.length === 0) return null
    const named = keys.map((k) => {
      const words = scoringRuleWords(k)
      return words ? `${words}: ${settingValueWords(b[k])} → ${settingValueWords(a[k])}` : null
    })
    return named.every((n): n is string => n !== null)
      ? `changed the scoring — ${listChanges(named)}`
      : `changed the scoring (${plural(keys.length, 'rule')})`
  },
  fork_scoring: ({ metadata }) => {
    const name = str(metadata.scoring_system_name)
    return name ? `switched the league to custom scoring (${name})` : null
  },
  edit_league_profile: ({ before, after }) => {
    const parts: string[] = []
    if ('name' in after) parts.push(`renamed the league from ${str(before.name) ?? 'its old name'} to ${str(after.name) ?? 'a new name'}`)
    if ('avatar_url' in after) parts.push('changed the league picture')
    return parts.length > 0 ? parts.join(' and ') : null
  },
  lifecycle_change: ({ before, after }) => {
    const from = LEAGUE_STAGE_WORDS[str(before.status) ?? '']
    const to = LEAGUE_STAGE_WORDS[str(after.status) ?? '']
    return from && to ? `moved the league from ${from} to ${to}` : null
  },
  // ---- the bracket (134) and waiver claims made for a team (145 / 150) ----
  edit_bracket: ({ after, metadata, team }) => {
    const round = num(metadata.round)
    const pairing = after.away_team_id ? `${team(after.home_team_id)} vs ${team(after.away_team_id)}` : `${team(after.home_team_id)} (bye)`
    return `set a ${round === null ? 'playoff' : `playoff round ${round}`} matchup: ${pairing}`
  },
  submit_waiver_claim: ({ targetId, metadata, team }) => `put in a waiver claim for ${team(targetId, metadata.team_name)}`,
  edit_waiver_claim: ({ targetId, metadata, team }) => `changed a waiver claim for ${team(targetId, metadata.team_name)}`,
  cancel_waiver_claim: ({ targetId, metadata, team }) => `cancelled a waiver claim for ${team(targetId, metadata.team_name)}`,
  reorder_waiver_claims: ({ targetId, metadata, team }) => `reordered ${team(targetId, metadata.team_name)}’s waiver claims`,
}

/** The fuller sentence for a receipt, or null when this file has no detail for
 *  its type (or the receipt lacks what the detail reads). */
export function receiptDetail(context: ReceiptContext): string | null {
  const build = DETAIL[context.actionType]
  return build ? build(context) : null
}

/** Exported for the census: the action types with a detailed sentence. */
export const DETAILED_ACTION_TYPES: readonly string[] = Object.keys(DETAIL)
