/**
 * Pure shapes and derivations for the platform operator console (M8 L.G1.6;
 * spec §24.4). The payload types mirror migration 186's `op_platform_state` /
 * `op_league_state` and 183 / 184 / 185's verb answers; nothing here computes
 * league state — the server already did, in plain words.
 */
import type { NotificationItem } from '@/hooks/use-notifications'

// ---------------------------------------------------------------------------
// Payloads (186)
// ---------------------------------------------------------------------------
export type OpJob = 'waivers' | 'week-advance' | 'week-finalize' | 'lineup-lock'
export type OpGameMark = 'in_week' | 'out_of_week' | 'cancelled'
export type OpGameStatus = OpGameMark | 'normal'

export interface OpPause {
  id: string
  job: Exclude<OpJob, 'lineup-lock'>
  league_id: string | null
  league_name?: string | null
  paused_at: string
  skipped_runs: number
  summary: string
}

export interface OpCronRun {
  job: string
  schedule: string
  active: boolean
  last_started_at: string | null
  last_status: string
  last_message: string | null
  summary: string
}

export interface OpGame {
  game_id: string
  matchup: string
  kickoff_at: string
  status: string | null
  operator_hold: OpGameMark | null
  holds_week: boolean
  reason: string
  season?: number
  week?: number
}

export interface OpPlatformState {
  as_of: string
  pauses: OpPause[]
  games: OpGame[]
  games_total: number
  games_limit: number
  live_weeks: { season: number; week: number; leagues: number }[]
  /** F600 (194): live weeks at or past their Wednesday release ceiling that
   *  games still hold. Absent from a database before 194 (deploy before push). */
  overdue_weeks?: OverdueWeek[]
  pending: { waiver_claims: number; players_waiting_to_be_rescored: number }
  cron: OpCronRun[]
}

export interface OverdueWeek {
  season: number
  week: number
  /** The week's release ceiling — Wednesday 00:00 Pacific (153). */
  ceiling_at: string
  hours_past_ceiling: number
  /** The matchups still holding it. */
  holding_games: string[]
}

export interface OpReceipt {
  id: string
  at: string
  action: string
  reason: string | null
  actor?: string | null
}

export interface OpLeagueState {
  as_of: string
  league: { id: string; name: string; season: number; status: string }
  weeks: { season: number; week: number; status: string; summary: string }[]
  open_weeks: { season: number; week: number; status: string; games: OpGame[]; players_waiting_to_be_rescored: number }[]
  pending: { waiver_claims: number; next_waiver_run_at: string | null }
  pauses: OpPause[]
  cron: OpCronRun[]
  commissioner_receipts: OpReceipt[]
  operator_receipts: OpReceipt[]
  receipts_limit: number
}

export interface OpLogRow {
  id: string
  action_id: string
  verb: string
  scope: 'platform' | 'league'
  league_id: string | null
  reason: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  created_at: string
}

/** Every verb answers `changed`; a no-op says `why` (183 / 184 / 185). */
export interface OpVerbResult {
  changed: boolean
  why?: string
  recipients?: number
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// The home page's "needs attention" (from op_platform_state)
// ---------------------------------------------------------------------------
export interface HeldWeek {
  season: number
  week: number
  games: OpGame[]
}

/** Weeks some league is still playing that a game is holding open. */
export function heldWeeks(state: Pick<OpPlatformState, 'games'>): HeldWeek[] {
  const by = new Map<string, HeldWeek>()
  for (const g of state.games) {
    if (!g.holds_week || g.season == null || g.week == null) continue
    const key = `${g.season}-${g.week}`
    const hit = by.get(key) ?? { season: g.season, week: g.week, games: [] }
    hit.games.push(g)
    by.set(key, hit)
  }
  return [...by.values()].sort((a, b) => a.season - b.season || a.week - b.week)
}

/** F600: weeks still held past Wednesday (none from a pre-194 database). */
export function overdueWeeks(state: Pick<OpPlatformState, 'overdue_weeks'>): OverdueWeek[] {
  return state.overdue_weeks ?? []
}

/** "2026 week 7 should have finished by Wednesday … and is 27 hours past it …" */
export function overdueWords(w: OverdueWeek, ceiling: string): string {
  const past = w.hours_past_ceiling < 1 ? 'is just past it' : `is ${w.hours_past_ceiling} ${w.hours_past_ceiling === 1 ? 'hour' : 'hours'} past it`
  const games = w.holding_games.length === 1 ? 'this game' : `these ${w.holding_games.length} games`
  return `${w.season} week ${w.week} should have finished by ${ceiling} and ${past}. It is still waiting on ${games}: ${w.holding_games.join(', ')}.`
}

/** Games FieldScout has marked (moved / cancelled). */
export function markedGames(state: Pick<OpPlatformState, 'games'>): OpGame[] {
  return state.games.filter((g) => g.operator_hold !== null)
}

/** Scheduled jobs whose last run failed, or that are switched off. */
export function stalledJobs(cron: readonly OpCronRun[]): OpCronRun[] {
  return cron.filter((c) => c.last_status === 'failed' || !c.active)
}

export function stalledWhy(c: OpCronRun): string {
  if (!c.active) return 'Switched off in the scheduler'
  return c.last_message ? `Last run failed: ${c.last_message}` : 'Last run failed'
}

export function attentionCount(state: OpPlatformState): number {
  return (
    overdueWeeks(state).length +
    heldWeeks(state).length +
    state.pauses.length +
    stalledJobs(state.cron).length +
    markedGames(state).length
  )
}

// ---------------------------------------------------------------------------
// Job knobs (Q98): which buttons each job has, and what each one does
// ---------------------------------------------------------------------------
export type JobVerb = 'pause' | 'resume' | 'run_now'

export const KNOB_JOBS: readonly OpJob[] = ['waivers', 'week-advance', 'week-finalize', 'lineup-lock']

export const JOB_NAME: Record<OpJob, string> = {
  waivers: 'Waivers',
  'week-advance': 'Week advance',
  'week-finalize': 'Week finalize',
  'lineup-lock': 'Lineup locking',
}

export const JOB_DOES: Record<OpJob, string> = {
  waivers: 'Runs waiver claims on the league’s schedule.',
  'week-advance': 'Opens and closes weeks on schedule.',
  'week-finalize': 'Makes finished weeks final.',
  'lineup-lock': 'Locks players at their kickoff. It can never be paused.',
}

/** Lineup locking is run-now only — pausing it would let people move players after kickoff (Q98). */
export function canPause(job: OpJob): boolean {
  return job !== 'lineup-lock'
}

export interface JobKnobState {
  /** Paused for exactly this scope (this league, or every league) — the pause these buttons control. */
  pausedHere: OpPause | null
  /** For a league: paused for every league, which only the every-league knob can lift. */
  pausedEverywhere: OpPause | null
}

export function jobKnobState(job: OpJob, pauses: readonly OpPause[], leagueId: string | null): JobKnobState {
  const open = pauses.filter((p) => p.job === job)
  return {
    pausedHere: open.find((p) => p.league_id === leagueId) ?? null,
    pausedEverywhere: leagueId === null ? null : (open.find((p) => p.league_id === null) ?? null),
  }
}

function scopeWords(leagueId: string | null): string {
  return leagueId === null ? 'every league' : 'this league'
}

/** The confirm dialog's before / after, in plain words. */
export function jobBeforeAfter(job: OpJob, verb: JobVerb, leagueId: string | null): { before: string; after: string } {
  const name = JOB_NAME[job]
  const scope = scopeWords(leagueId)
  // "Waivers run" / "Week advance runs" — the job names agree in number.
  const plural = job === 'waivers'
  const runs = plural ? 'run' : 'runs'
  const is = plural ? 'are' : 'is'
  if (verb === 'pause') {
    return {
      before: `${name} ${runs} on schedule for ${scope}.`,
      after:
        `${name} ${is} paused for ${scope} until you resume ${plural ? 'them' : 'it'}.` +
        (job === 'waivers' ? ' Pending claims keep their order.' : ''),
    }
  }
  if (verb === 'resume') {
    return {
      before: `${name} ${is} paused for ${scope}.`,
      after: `${name} ${runs} again for ${scope}. Anything that waited happens at the next run.`,
    }
  }
  return {
    before: `${name} next ${runs} on ${plural ? 'their' : 'its'} schedule.`,
    after: `${name} ${runs} now for ${scope}, under the usual rules. If nothing is due, nothing changes.`,
  }
}

export const VERB_LABEL: Record<JobVerb, string> = { pause: 'Pause', resume: 'Resume', run_now: 'Run now' }

// ---------------------------------------------------------------------------
// Game marks (Q100)
// ---------------------------------------------------------------------------
export const GAME_STATUS_LABEL: Record<OpGameStatus, string> = {
  in_week: 'Moved later this week',
  out_of_week: 'Moved out of the week',
  cancelled: 'Cancelled',
  normal: 'Back to normal',
}

export const GAME_STATUS_EFFECT: Record<OpGameStatus, string> = {
  in_week: 'The week waits for this game.',
  out_of_week: 'Its players score 0 and the week can close.',
  cancelled: 'Its players score 0 and the week can close.',
  normal: 'The mark is cleared; the game follows the normal schedule again.',
}

export function currentGameStatus(g: Pick<OpGame, 'operator_hold'>): OpGameStatus {
  return g.operator_hold ?? 'normal'
}

/** The marks a game can move to from where it is (never the one it already has). */
export function gameStatusChoices(g: Pick<OpGame, 'operator_hold' | 'status'>): OpGameStatus[] {
  if (g.status === 'final') return []
  const now = currentGameStatus(g)
  return (['in_week', 'out_of_week', 'cancelled', 'normal'] as const).filter((s) => s !== now)
}

export function gameBeforeAfter(g: Pick<OpGame, 'operator_hold'>, to: OpGameStatus): { before: string; after: string } {
  const from = currentGameStatus(g)
  return {
    before: from === 'normal' ? 'Not marked. The game follows the normal schedule.' : `${GAME_STATUS_LABEL[from]}. ${GAME_STATUS_EFFECT[from]}`,
    after: `${GAME_STATUS_LABEL[to]}. ${GAME_STATUS_EFFECT[to]}`,
  }
}

// ---------------------------------------------------------------------------
// Verb answers in plain words
// ---------------------------------------------------------------------------
/** "already_paused — this pause is …" → "This pause is …" */
export function noOpWords(why: string | undefined): string {
  if (!why) return 'Nothing changed.'
  const text = why.includes(' — ') ? why.slice(why.indexOf(' — ') + 3) : why
  return text.charAt(0).toUpperCase() + text.slice(1) + (text.endsWith('.') ? '' : '.')
}

// ---------------------------------------------------------------------------
// League finder
// ---------------------------------------------------------------------------
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** A pasted league link or id → the league id, or null for a name search. */
export function leagueIdFromInput(input: string): string | null {
  const hit = input.trim().match(UUID_RE)
  return hit ? hit[0].toLowerCase() : null
}

// ---------------------------------------------------------------------------
// Operator log
// ---------------------------------------------------------------------------
export const VERB_WORDS: Record<string, string> = {
  pause_job: 'Paused a job',
  resume_job: 'Resumed a job',
  run_job_now: 'Ran a job now',
  set_game_status: 'Marked a game',
  send_notification: 'Sent a notice',
  set_commissioner: 'Made a commissioner',
}

export function verbWords(verb: string): string {
  return VERB_WORDS[verb] ?? verb.replace(/_/g, ' ')
}

/** One line of detail from a receipt's `after`. */
export function receiptDetail(row: Pick<OpLogRow, 'verb' | 'after'>): string {
  const a = row.after ?? {}
  const job = typeof a.job === 'string' && a.job in JOB_NAME ? JOB_NAME[a.job as OpJob] : null
  if (row.verb === 'send_notification') {
    const n = typeof a.recipients === 'number' ? a.recipients : null
    const title = typeof a.title === 'string' ? `“${a.title}”` : 'A notice'
    return n === null ? title : `${title} to ${n} ${n === 1 ? 'person' : 'people'}`
  }
  if (row.verb === 'set_game_status') {
    // 184's `after.operator_hold` is the mark (null = back to normal).
    const hold = a.operator_hold
    const to = hold === null ? GAME_STATUS_LABEL.normal
      : typeof hold === 'string' && hold in GAME_STATUS_LABEL ? GAME_STATUS_LABEL[hold as OpGameStatus] : null
    const game = typeof a.game_id === 'string' ? a.game_id : 'a game'
    return to ? `${game}: ${to}` : game
  }
  return job ?? ''
}

// ---------------------------------------------------------------------------
// Notify page (185)
// ---------------------------------------------------------------------------
export type NoticeAudience = 'all_league_members' | 'all_users' | 'league'

export const AUDIENCE_LABEL: Record<NoticeAudience, string> = {
  all_league_members: 'Everyone in any league',
  all_users: 'Every app user',
  league: 'One league’s members',
}

export interface NoticeDraft {
  audience: NoticeAudience
  leagueId: string | null
  leagueName: string | null
  title: string
  body: string
  link: string
  /** The retry key: kept across retries of this compose, replaced after a send. */
  actionId: string
  /** Who wrote it — a stored draft for anyone else is discarded (R1562). */
  ownerId: string
}

/** The pre-R1562 unkeyed key — removed on sight, never restored. */
export const LEGACY_NOTICE_DRAFT_KEY = 'fs-admin-notice-draft'

/** Drafts are kept per user (R1562): two admins on one browser never see each other's. */
export function noticeDraftKey(userId: string): string {
  return `${LEGACY_NOTICE_DRAFT_KEY}:${userId}`
}
export const NOTICE_TITLE_MAX = 120
export const NOTICE_BODY_MAX = 2000

export function emptyNoticeDraft(actionId: string, ownerId = ''): NoticeDraft {
  return { audience: 'all_league_members', leagueId: null, leagueName: null, title: '', body: '', link: '', actionId, ownerId }
}

/** A stored draft back from localStorage — anything malformed is dropped, never half-used. */
export function parseNoticeDraft(raw: string | null, ownerId: string): NoticeDraft | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as Partial<NoticeDraft>
    if (
      d && typeof d === 'object' &&
      (d.audience === 'all_league_members' || d.audience === 'all_users' || d.audience === 'league') &&
      typeof d.title === 'string' && typeof d.body === 'string' && typeof d.link === 'string' &&
      typeof d.actionId === 'string' && UUID_RE.test(d.actionId) &&
      d.ownerId === ownerId && ownerId !== ''
    ) {
      return {
        audience: d.audience,
        leagueId: typeof d.leagueId === 'string' ? d.leagueId : null,
        leagueName: typeof d.leagueName === 'string' ? d.leagueName : null,
        title: d.title,
        body: d.body,
        link: d.link,
        actionId: d.actionId,
        ownerId: d.ownerId,
      }
    }
  } catch {
    // fall through
  }
  return null
}

type DraftStorage = Pick<Storage, 'getItem' | 'removeItem'>

/**
 * Restore this user's draft: the legacy unkeyed draft is removed; a stored
 * draft that does not belong to `ownerId` (or is malformed) is removed too,
 * never restored.
 */
export function restoreNoticeDraft(storage: DraftStorage, ownerId: string): NoticeDraft | null {
  storage.removeItem(LEGACY_NOTICE_DRAFT_KEY)
  const key = noticeDraftKey(ownerId)
  const raw = storage.getItem(key)
  const d = parseNoticeDraft(raw, ownerId)
  if (raw !== null && d === null) storage.removeItem(key)
  return d
}

/** 185's link rule: a page inside FieldScout, starting with one "/". Blank is fine (no link). */
export function noticeLinkOk(link: string): boolean {
  const l = link.trim()
  return l === '' || (l.length <= 500 && /^\/([^/\\\s][^\\\s]*)?$/.test(l))
}

/** What stops a send, in plain words — or null when it can go. */
export function noticeProblem(d: NoticeDraft): string | null {
  if (d.title.trim() === '') return 'Add a title.'
  if (d.title.trim().length > NOTICE_TITLE_MAX) return `The title is at most ${NOTICE_TITLE_MAX} characters.`
  if (d.body.trim().length > NOTICE_BODY_MAX) return `The message is at most ${NOTICE_BODY_MAX} characters.`
  if (!noticeLinkOk(d.link)) return 'A link must be a page inside FieldScout, starting with “/”.'
  if (d.audience === 'league' && !d.leagueId) return 'Pick the league.'
  return null
}

/** The request body POST /api/admin/notifications takes. */
export function noticeRequest(d: NoticeDraft) {
  return {
    audience: d.audience,
    league_id: d.audience === 'league' ? (d.leagueId ?? undefined) : undefined,
    title: d.title.trim(),
    body: d.body.trim() === '' ? undefined : d.body.trim(),
    link: d.link.trim() === '' ? undefined : d.link.trim(),
    channels: ['in_app'] as const,
    action_id: d.actionId,
  }
}

/** The notice exactly as a recipient's rail row receives it (185's `data`). */
export function noticePreviewItem(d: NoticeDraft, now: string): NotificationItem {
  const leagueId = d.audience === 'league' ? d.leagueId : null
  return {
    id: 'preview',
    type: 'operator_notice',
    title: d.title.trim() || 'Your title',
    body: d.body.trim() === '' ? null : d.body.trim(),
    data: {
      from: 'fieldscout',
      ...(leagueId ? { league_id: leagueId } : {}),
      ...(d.link.trim() ? { link: d.link.trim() } : {}),
    },
    read: false,
    created_at: now,
  }
}
