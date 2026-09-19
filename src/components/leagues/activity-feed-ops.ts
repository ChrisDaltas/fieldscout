/**
 * Activity feed — pure derivation (M4 task L.D5.4; spec §13.4, §16.2
 * `activity-feed` "unified feed w/ commissioner action treatment", §16.5.1's
 * `in_season` row "activity feed"; PROGRESS D310(5), D324).
 *
 * Labels the feed's items (`activity-service.ts`'s M4 slice: `transactions`
 * rows + the league room's D97 system posts). A transaction's sentence is
 * read from its STORED payload (113 writes the names into it) and the team
 * from the league detail's list; nothing is computed. The "✸ commissioner"
 * treatment §13.4 names is a LABEL today, worn by a system post ONLY when
 * an actor wrote it (a NULL actor is a worker's notice and wears a plain
 * "system" chip — R895) — the link to the audit entry needs
 * `commissioner_actions`, which is a later milestone's (F233(d)); the feed
 * carries `kind`/`context` so the label renders now and the link lands
 * without a shape change.
 */
import type { ActivityItem, TransactionActivityItem } from '@/lib/leagues/api/activity-service'
import type { CommishLogItem } from '@/lib/leagues/api/commish-log-service'

export interface FeedLine {
  id: string
  kind: 'transaction' | 'system'
  /** The one-line sentence. */
  text: string
  /** The team the move belongs to, by name (null for a system post). */
  team: string | null
  /**
   * That same team's id — carried so the rendered name can be a door to the
   * team page (§16.1). NULL whenever `team` is null (a system post, or an
   * id the league detail could not name): a name we could not resolve gets
   * no link.
   */
  teamId: string | null
  week: number | null
  createdAt: string | null
  /** §13.4's commissioner treatment. A system post is a commissioner's act
   *  when it carries an ACTOR (111/112/114/120 write `auth.uid()` in-
   *  transaction); the week workers' notices (116→118 `finalize_matchups`'s
   *  postponed-game post) carry `user_id NULL` — the engine's, labelled as
   *  such, never as a person's (R895). */
  commissioner: boolean
}

interface AddDropPayloadShape {
  add?: { name?: unknown; player_id?: unknown; position?: unknown; nfl_team?: unknown } | null
  drop?: { name?: unknown; player_id?: unknown; position?: unknown; nfl_team?: unknown } | null
}

function playerLabel(p: { name?: unknown; player_id?: unknown; position?: unknown; nfl_team?: unknown } | null | undefined): string | null {
  if (!p) return null
  const name = typeof p.name === 'string' && p.name ? p.name : typeof p.player_id === 'string' ? p.player_id : null
  if (!name) return null
  const tag = [p.position, p.nfl_team].filter((x): x is string => typeof x === 'string' && x !== '').join(' · ')
  return tag ? `${name} (${tag})` : name
}

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  add_drop: 'Roster move',
  waiver_claim: 'Waiver claim',
  trade: 'Trade',
  commissioner_move: 'Commissioner move',
  draft_pick: 'Draft pick',
}

/** One transaction as a sentence: `add_drop` from its payload's names; any
 *  other type by its label (the table is read whole — a later writer's rows
 *  land here labelled, never hidden). */
export function transactionText(item: TransactionActivityItem): string {
  if (item.type === 'add_drop' && item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)) {
    const payload = item.payload as AddDropPayloadShape
    const add = playerLabel(payload.add)
    const drop = playerLabel(payload.drop)
    const parts: string[] = []
    if (add) parts.push(`added ${add}`)
    if (drop) parts.push(`dropped ${drop}`)
    if (parts.length > 0) return parts.join(', ')
  }
  const label = TRANSACTION_TYPE_LABELS[item.type] ?? item.type.replace(/_/g, ' ')
  return item.status === 'complete' ? label : `${label} (${item.status})`
}

export function feedLines(items: readonly ActivityItem[], teamNames: ReadonlyMap<string, string>): FeedLine[] {
  return items.map((item) => {
    if (item.kind === 'system') {
      return {
        id: item.id,
        kind: 'system',
        text: item.message,
        team: null,
        teamId: null,
        week: null,
        createdAt: item.created_at,
        commissioner: item.actor_id !== null,
      }
    }
    const team = item.team_id ? (teamNames.get(item.team_id) ?? null) : null
    return {
      id: item.id,
      kind: 'transaction',
      text: transactionText(item),
      team,
      teamId: team !== null ? item.team_id : null,
      week: item.week,
      createdAt: item.created_at,
      commissioner: item.type === 'commissioner_move',
    }
  })
}

export const FEED_EMPTY_COPY = 'Nothing has happened yet — roster moves and commissioner notices land here.'
export const FEED_TITLE = 'Activity'
export const COMMISSIONER_LABEL = '✸ commissioner'
/** The chip on a system post NOBODY posted (`actor_id` NULL — a week
 *  worker's notice). Plain, so a postponed-week argument is not pointed at
 *  the commissioner (R895). */
export const SYSTEM_LABEL = 'system'

// ---------------------------------------------------------------------------
// COMMISSIONER ACTIONS — the §10.3 log, shown in League Home's activity
// section (M6A L.E1.13; Q66, spec v2.16.41 §10 / §10.3: *"What is required is
// storing the transaction and displaying it in the 'activity' section of the
// League Home"*). Reads `GET /commish/log` (`use-commish-log.ts`).
//
// Three rules the rendering keeps (D364(8)/(9)):
//  * A row is a CLAIM that a commissioner acted, not proof a verb ran (C70 —
//    123:335 lets a commissioner's client append one). Nothing here says
//    "applied" / "verified", and the section's title is the LOG's.
//  * The ACT is read from the `before`/`after` KEY SET, never from
//    `action_type` alone (F355 — a rename's `action_type` is
//    `'reassign_team'`, which does not say "rename" to a reader).
//  * A NULL reason renders as ABSENT — never the word "null", never an empty
//    "— reason:" clause (§10.3: *"an entry with no reason renders as such,
//    never as an empty quote"*).
// ---------------------------------------------------------------------------

export const COMMISH_LOG_TITLE = 'Commissioner actions'
export const COMMISH_LOG_EMPTY_COPY = 'No commissioner actions yet — every correction a commissioner makes is listed here, for the whole league to see.'
export const COMMISH_LOG_PROBLEM_COPY = 'Couldn’t load the commissioner actions.'
export const COMMISH_LOG_UNNAMED_ACTOR = 'A commissioner'

export interface CommishLogLine {
  id: string
  actor: string
  /** What the row records, in words — never empty. */
  text: string
  /** The reason AS GIVEN, or null when none was (rendered as absent). */
  reason: string | null
  createdAt: string
}

type Doc = Record<string, unknown>
const asDoc = (value: unknown): Doc => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Doc) : {})
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

function weekClause(metadata: Doc): string {
  const week = num(metadata.week)
  return week === null ? '' : `Week ${week} `
}

/** A settings value in words: a scalar as itself, null as "none", anything
 *  structured as "(updated)" — never `[object Object]`, never "null". */
function settingValue(value: unknown): string {
  if (value === null || value === undefined) return 'none'
  if (typeof value === 'object') return '(updated)'
  return String(value)
}

const score = (value: unknown): string => (num(value) === null ? '—' : String(value))

function actText(item: Pick<CommishLogItem, 'action_type' | 'target_type' | 'target_id' | 'before' | 'after' | 'metadata'>, teamNames: ReadonlyMap<string, string>): string {
  const before = asDoc(item.before)
  const after = asDoc(item.after)
  const metadata = asDoc(item.metadata)

  // A RENAME — 128 writes {name} both sides (action_type 'reassign_team', F355).
  if ('name' in after && 'name' in before) {
    return `renamed ${text(before.name) ?? 'a team'} to ${text(after.name) ?? 'a new name'}`
  }
  // A LINEUP — 123 writes the whole lineup row both sides.
  if ('slot_map' in after) {
    const team = (item.target_id ? teamNames.get(item.target_id) : undefined) ?? text(metadata.team_name) ?? 'a team'
    return `set ${team}’s ${weekClause(metadata)}lineup`
  }
  // A SCORE / RESULT — 126 writes {home_score, away_score, result, is_overridden}.
  if ('home_score' in after || 'result' in after) {
    const moved = before.home_score !== after.home_score || before.away_score !== after.away_score
    return moved
      ? `corrected a ${weekClause(metadata)}score: ${score(before.home_score)}–${score(before.away_score)} → ${score(after.home_score)}–${score(after.away_score)}`
      : `set the result of a ${weekClause(metadata)}matchup`
  }
  // A REMIX — 131's receipt carries the seed both sides.
  if ('schedule_seed' in after) {
    const changed = num(metadata.change_count)
    return `remixed the schedule${changed === null ? '' : ` (${changed} team-week pairings changed)`}`
  }
  // A ROSTER MOVE — 127 writes {team_id, slot_key, acquisition_type} both
  // sides and names the player and the teams in metadata.
  if ('acquisition_type' in after || 'acquisition_type' in before) {
    const player = text(metadata.player_name) ?? 'a player'
    const from = text(metadata.from_team_name)
    const to = text(metadata.to_team_name)
    if (from && to) return `moved ${player} from ${from} to ${to}`
    if (to) return `added ${player} to ${to}`
    if (from) return `dropped ${player} from ${from}`
    return `changed ${player}’s roster spot`
  }
  // A SETTING — 129 writes {<key>: value} both sides, ONE key.
  if (item.target_type === 'setting') {
    const key = Object.keys(after)[0] ?? item.target_id ?? 'a setting'
    return `changed the ${key.replace(/_/g, ' ')} setting: ${settingValue(before[key])} → ${settingValue(after[key])}`
  }
  // A SCHEDULE EDIT — 130/131 write the pairing both sides.
  if (item.target_type === 'schedule') return `edited a ${weekClause(metadata)}matchup pairing`
  // Anything newer than this file: the action's own name — never an empty line.
  return item.action_type.replace(/_/g, ' ')
}

export function commishLogLines(items: readonly CommishLogItem[], teamNames: ReadonlyMap<string, string>): CommishLogLine[] {
  return items.map((item) => {
    const actingFor = item.acting_as_team_id ? teamNames.get(item.acting_as_team_id) : undefined
    return {
      id: item.id,
      actor: text(item.actor.username) ?? COMMISH_LOG_UNNAMED_ACTOR,
      text: `${actText(item, teamNames)}${actingFor ? ` (acting for ${actingFor})` : ''}`,
      reason: text(item.reason)?.trim() ?? null,
      createdAt: item.created_at,
    }
  })
}
