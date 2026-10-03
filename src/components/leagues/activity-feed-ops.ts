/**
 * Activity feed — pure derivation (M4 task L.D5.4; spec §13.4, §16.2
 * `activity-feed` "unified feed w/ commissioner action treatment", §16.5.1's
 * `in_season` row "activity feed"; PROGRESS D310(5), D324).
 *
 * Labels the feed's items (`activity-service.ts`'s M4 slice: `transactions`
 * rows + the league room's D97 system posts). A transaction's sentence is
 * read from its STORED payload (113 writes the names into it) and the team
 * from the league detail's list; nothing is computed. The "✸ commissioner"
 * treatment §13.4 names is worn by a system post ONLY when an actor wrote it
 * (a NULL actor is a worker's notice and wears a plain "system" chip — R895)
 * and by a commissioner's roster move.
 *
 * **M6 L.E1.34 (F233(d), F463, Q84; PROGRESS D459).** Each feed item carries
 * the §10.3 receipt written in its own transaction (`commish_action_id`,
 * `activity-service.ts`), so a ✸ line links to its log entry. When a
 * commissioner's act wrote BOTH a feed row and a post (a reversal, a forced
 * or approved trade, a force add / drop), the feed shows ONE line — the
 * transaction's, with the ✸ treatment — never the pair (`feedLines`).
 */
import type { ActivityItem, TransactionActivityItem } from '@/lib/leagues/api/activity-service'
import type { CommishLogItem } from '@/lib/leagues/api/commish-log-service'

import { markUsername, plainText, stripMarks } from '@/components/shared/username-link-ops'

import type { NamedPlayer } from '@/components/players/player-link-ops'

import { COMMISH_ACTION_WORDS, actionWords, receiptDetail, settingChange } from './commish-log-copy'

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
  /** The §10.3 log entry this line's act wrote (F233(d)) — the ✸ line links
   *  to it; null when the act left no receipt. */
  commishActionId: string | null
  /** A system post's actor, by his CURRENT username (the league's member
   *  list) — the post's text names him, and that name links to his profile
   *  (L.E1.41, `splitActorName`). Null for a transaction, a NULL-actor post,
   *  or an actor no longer in the league. */
  actorUsername: string | null
  /** The players the line's text names, with their ids — each name renders
   *  as a door to his card (League UX batch 2). Absent = none. */
  players?: NamedPlayer[]
}

/** The players a stored add / drop / claim payload names (113's `add` /
 *  `drop` objects carry the id and the name). */
export function payloadPlayers(payload: unknown): NamedPlayer[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const p = payload as AddDropPayloadShape
  const out: NamedPlayer[] = []
  for (const side of [p.add, p.drop]) {
    if (side && typeof side.player_id === 'string' && typeof side.name === 'string' && side.name !== '') out.push({ playerId: side.player_id, name: side.name })
  }
  return out
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
  add: 'Added a player',
  drop: 'Dropped a player',
  add_drop: 'Roster move',
  waiver_claim: 'Waiver claim',
  trade: 'Trade',
  commissioner_move: 'Commissioner move',
  draft_pick: 'Draft pick',
}

/** A WON claim's `transactions` row (TD9 — only a won claim writes one, TD3).
 *  The players are read in 113's `add` / `drop` object shape when the
 *  processor writes it (F416 asks L.D2.9 to); the bare TD9 ids alone name no
 *  one, so they render as "a player" rather than as a provider id. */
interface WaiverClaimPayloadShape extends AddDropPayloadShape {
  faab_bid?: unknown
  faab_before?: unknown
}

/** One won claim as a sentence — the winning bid is public (TD3: "the losing
 *  manager sees the winning amount"), shown when the run debited FAAB
 *  (`faab_before` present) — a priority league's $0 is not a price. M5
 *  L.D2.12. */
export function waiverClaimText(payload: WaiverClaimPayloadShape): string {
  const add = playerLabel(payload.add) ?? 'a player'
  const drop = playerLabel(payload.drop)
  const price = typeof payload.faab_bid === 'number' && typeof payload.faab_before === 'number' ? ` for $${payload.faab_bid}` : ''
  return `claimed ${add} off waivers${price}${drop ? `, dropped ${drop}` : ''}`
}

/** A trade's `transactions` row (151 / 156 write `summary` — "Alpha gives X;
 *  Bravo gives Y" — into the payload, F438): the executed trade, and the
 *  commissioner's reversal (a `commissioner_move` row, `kind =
 *  'trade_reversal'`). M5 L.D3.7 (F415). */
interface TradePayloadShape {
  summary?: unknown
  kind?: unknown
  via?: unknown
}

export function tradeTransactionText(type: string, payload: TradePayloadShape): string | null {
  const summary = typeof payload.summary === 'string' && payload.summary.trim() !== '' ? payload.summary : null
  if (type === 'trade') {
    const how =
      payload.via === 'commissioner_force'
        ? ' (forced through by the commissioner)'
        : payload.via === 'commissioner_approve'
          ? ' (approved by the commissioner)'
          : ''
    return summary ? `completed a trade${how}: ${summary}` : `completed a trade${how}`
  }
  if (type === 'commissioner_move' && payload.kind === 'trade_reversal') {
    return summary ? `reversed a trade — every player went back: ${summary}` : 'reversed a trade — every player went back'
  }
  return null
}

/** A retirement's ledger row (120 / 173: a `commissioner_move` whose payload
 *  is the verb's own result, `verb = 'retire_franchise'`) — F262(a), L.E1.40:
 *  the retired team, the team that takes its place and from when, from the
 *  stored payload; never a bare "Commissioner move". HISTORY ONLY since 176
 *  (L.E1.42 — a team is never retired): no verb writes one any more, but a
 *  row written before it is immutable and still reads. */
interface RetirePayloadShape {
  verb?: unknown
  retired_team_name?: unknown
  successor_team_name?: unknown
  retired_at_week?: unknown
}

export function retireTransactionText(payload: RetirePayloadShape): string | null {
  if (payload.verb !== 'retire_franchise') return null
  const retired = typeof payload.retired_team_name === 'string' && payload.retired_team_name.trim() !== '' ? payload.retired_team_name : 'a team'
  const successor = typeof payload.successor_team_name === 'string' && payload.successor_team_name.trim() !== '' ? payload.successor_team_name : 'a new team'
  const when = typeof payload.retired_at_week === 'number' ? ` from Week ${payload.retired_at_week}` : ' after the season'
  return `retired ${retired} — ${successor} takes its place${when}`
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
  if (item.type === 'waiver_claim' && item.status === 'complete' && item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)) {
    return waiverClaimText(item.payload as WaiverClaimPayloadShape)
  }
  if ((item.type === 'trade' || item.type === 'commissioner_move') && item.status === 'complete' && item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)) {
    const line = tradeTransactionText(item.type, item.payload as TradePayloadShape)
    if (line) return line
    if (item.type === 'commissioner_move') {
      const retired = retireTransactionText(item.payload as RetirePayloadShape)
      if (retired) return retired
    }
  }
  const label = TRANSACTION_TYPE_LABELS[item.type] ?? item.type.replace(/_/g, ' ')
  return item.status === 'complete' ? label : `${label} (${item.status})`
}

/**
 * The feed's items as lines, newest first, ONE line per act (Q84 / F463):
 * when a transaction and a system post carry the same receipt (the
 * commissioner's act wrote both in one transaction — a reversal, a forced or
 * approved trade, a force add / drop), the post is dropped and the
 * transaction's line wears the ✸ treatment and links to the entry. Pass
 * every loaded page at once so a pair split across two pages still folds.
 */
export function feedLines(
  items: readonly ActivityItem[],
  teamNames: ReadonlyMap<string, string>,
  memberNames: ReadonlyMap<string, string> = new Map(),
): FeedLine[] {
  const receiptsOnTransactions = new Set(
    items.flatMap((item) => (item.kind === 'transaction' && item.commish_action_id ? [item.commish_action_id] : [])),
  )
  return items.flatMap((item): FeedLine[] => {
    const commishActionId = item.commish_action_id ?? null
    if (item.kind === 'system') {
      if (commishActionId !== null && receiptsOnTransactions.has(commishActionId)) return []
      return [
        {
          id: item.id,
          kind: 'system',
          text: item.message,
          team: null,
          teamId: null,
          week: item.week ?? null,
          createdAt: item.created_at,
          commissioner: item.actor_id !== null,
          commishActionId,
          actorUsername: item.actor_id ? (memberNames.get(item.actor_id) ?? null) : null,
        },
      ]
    }
    const team = item.team_id ? (teamNames.get(item.team_id) ?? null) : null
    return [
      {
        id: item.id,
        kind: 'transaction',
        text: transactionText(item),
        team,
        teamId: team !== null ? item.team_id : null,
        week: item.week,
        createdAt: item.created_at,
        commissioner: item.type === 'commissioner_move' || commishActionId !== null,
        commishActionId,
        actorUsername: null,
        players: payloadPlayers(item.payload),
      },
    ]
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
//    123:335 let a commissioner's client append one until migration 175,
//    F555; those rows stay). Nothing here says
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
  /** The actor's username — his name is a door to his profile (L.E1.41);
   *  null when the log names no one ("A commissioner"). */
  actorUsername: string | null
  /** What the row records, in words — never empty. */
  text: string
  /** The same words with each member's username marked (`markUsername`), so
   *  the renderer links exactly the names the sentence interpolated (L.E1.41). */
  marked: string
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

const score = (value: unknown): string => (num(value) === null ? '—' : String(value))

/** Everything the words for one receipt need: the team and member names, and
 *  a record of which teams the sentence named (F518). */
interface LineNames {
  teamNames: ReadonlyMap<string, string>
  memberNames: ReadonlyMap<string, string>
}

function actText(
  item: Pick<CommishLogItem, 'action_type' | 'target_type' | 'target_id' | 'before' | 'after' | 'metadata'>,
  names: LineNames,
  named: Set<string>,
): string {
  const before = asDoc(item.before)
  const after = asDoc(item.after)
  const metadata = asDoc(item.metadata)
  const team = (id: unknown, fallback?: unknown): string => {
    const name = (typeof id === 'string' ? names.teamNames.get(id) : undefined) ?? text(fallback) ?? 'a team'
    named.add(name)
    return name
  }
  // L.E1.41: a member's name is MARKED where the sentence names him, so the
  // log links that person — and only him — to his profile.
  const member = (userId: unknown): string | null => {
    const username = typeof userId === 'string' ? (names.memberNames.get(userId) ?? null) : null
    return username === null ? null : markUsername(username)
  }

  // A LEAGUE's name or picture (169) — before the team-rename branch below,
  // which reads the same {name} key set.
  if (item.action_type === 'edit_league_profile') {
    return receiptDetail({ actionType: item.action_type, targetId: item.target_id, before, after, metadata, team, member }) ?? actionWords(item.action_type)
  }
  // A RENAME — 128 writes {name} both sides (action_type 'reassign_team', F355).
  if ('name' in after && 'name' in before) {
    const renamed = `renamed ${text(before.name) ?? 'a team'} to ${text(after.name) ?? 'a new name'}`
    named.add(text(after.name) ?? '')
    named.add(text(before.name) ?? '')
    if (item.target_id) named.add(names.teamNames.get(item.target_id) ?? '')
    return renamed
  }
  // THE AUTOPILOT SWITCH — 139 writes {autopilot} both sides (M6A L.E1.22,
  // Q63). Read from the key set like every other act (F355), so the words
  // follow the switch's direction and never the verb's name.
  if ('autopilot' in after && typeof after.autopilot === 'boolean') {
    const name = team(item.target_id, metadata.team_name)
    return after.autopilot ? `put ${name} on autopilot` : `took ${name} off autopilot`
  }
  // A FAAB EDIT — 147 writes {faab_balance} both sides (M5 L.D2.11). The
  // balance is member-visible, so the amounts are shown; an unset one reads
  // "unset", never "null".
  if ('faab_balance' in after) {
    const name = team(item.target_id, metadata.team_name)
    const dollars = (value: unknown): string => {
      const amount = num(value)
      return amount === null ? 'unset' : `$${amount}`
    }
    return `set ${name}’s FAAB balance: ${dollars(before.faab_balance)} → ${dollars(after.faab_balance)}`
  }
  // A TRADE OVERRIDE — 156 writes {status} both sides and names the op and
  // the deal in metadata (M5 L.D3.5). Trades are member-visible, so the deal
  // is shown; the op is what the commissioner did (approve / veto / force /
  // reverse), never the verb's name.
  if (item.target_type === 'trade' && 'status' in after && metadata.verb === 'commish_force_or_reverse_trade') {
    const act = ({ approve: 'approved a trade', veto: 'vetoed a trade', force: 'forced a trade through', reverse: 'reversed a trade' } as Record<string, string>)[text(metadata.op) ?? '']
    if (act) {
      const summary = text(metadata.summary)
      return summary ? `${act}: ${summary}` : act
    }
  }
  // A MANAGER'S TRADE MOVE MADE BY THE COMMISSIONER — 148 / 151's TD5 arm
  // (M5 L.D3.7, F415): `propose_trade` / `accept_trade` / `reject_trade` /
  // `cancel_trade` / `counter_trade`, {status} both sides, the deal in
  // metadata; the team he acted for is the caller's "(for …)".
  if (item.target_type === 'trade' && (metadata.verb === 'trade_propose' || metadata.verb === 'trade_respond')) {
    const act = COMMISH_ACTION_WORDS[item.action_type]
    if (act) {
      const summary = text(metadata.summary)
      return summary ? `${act}: ${summary}` : act
    }
  }
  // A LINEUP — 123 / 169 write the whole lineup row both sides.
  if ('slot_map' in after) {
    return `set ${team(item.target_id, metadata.team_name)}’s ${weekClause(metadata)}lineup`
  }
  // A RULED RE-SCORE OF A FINAL WEEK — 161 writes {week_scores} both sides
  // (M5 L.D3.13, D425). Not a commissioner's own act: the actor is the
  // person whose ruling it is, and the league's post says why in plain words.
  if ('week_scores' in after) {
    const changed = num(metadata.scores_changed)
    return `re-scored ${weekClause(metadata)}after it was final${changed === null ? '' : ` (${changed} team score${changed === 1 ? '' : 's'} changed)`}`
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
    if (from) named.add(from)
    if (to) named.add(to)
    if (from && to) return `moved ${player} from ${from} to ${to}`
    if (to) return `added ${player} to ${to}`
    if (from) return `dropped ${player} from ${from}`
    return `changed ${player}’s roster spot`
  }
  // A SETTING — 129 writes {<key>: value} both sides, ONE key (TD12: the key
  // and its values in words — `commish-log-copy.ts`).
  if (item.target_type === 'setting') {
    const key = Object.keys(after)[0] ?? item.target_id
    return key ? `changed the ${settingChange(key, before[key], after[key])}` : actionWords(item.action_type)
  }
  // A SCHEDULE EDIT — 130/131 write the pairing both sides.
  if (item.target_type === 'schedule') return `edited a ${weekClause(metadata)}matchup pairing`
  // Every other receipt (L.E1.34 — TD12, F512 / F516): its detailed sentence
  // when this file knows its shape, else its type's words. Never a code word.
  return receiptDetail({ actionType: item.action_type, targetId: item.target_id, before, after, metadata, team, member }) ?? actionWords(item.action_type)
}

/**
 * The §10.3 log as lines. `memberNames` (user id → username, from the league
 * detail) lets a membership receipt name the member; without it the line says
 * what happened without the name.
 *
 * **"(for <team>)" (TD12 / TD16; F518).** A receipt the commissioner wrote
 * while doing one team's manager act (`acting_as_team_id`, D451) says which
 * team he did it for — unless the sentence already names that team ("set
 * Alpha's Week 3 lineup", "made pick 12 for Alpha"), where the suffix would
 * only repeat it.
 */
export function commishLogLines(
  items: readonly CommishLogItem[],
  rawTeamNames: ReadonlyMap<string, string>,
  memberNames: ReadonlyMap<string, string> = new Map(),
): CommishLogLine[] {
  // R1403: the sentence marks usernames in-band, so every OTHER string it can
  // interpolate — team names (free text: 128's rename only trims and caps),
  // and whatever the receipt's before / after / metadata carry (player names,
  // trade summaries, from / to teams, setting values) — loses the marks first.
  // Stripped here, once, so no interpolation site (here or `receiptDetail`)
  // can forget. Usernames are marked by `member()` only.
  const teamNames = new Map([...rawTeamNames].map(([id, name]) => [id, stripMarks(name)]))
  return items.map((raw) => {
    const item = {
      ...raw,
      target_id: raw.target_id === null ? null : stripMarks(raw.target_id),
      before: unmarked(raw.before) as CommishLogItem['before'],
      after: unmarked(raw.after) as CommishLogItem['after'],
      metadata: unmarked(raw.metadata) as CommishLogItem['metadata'],
    }
    const named = new Set<string>()
    // F549: the people this receipt names, as the log's own read resolved
    // them (a removed manager is no longer in the league's member list),
    // under the member list (the league detail's current usernames).
    const people = item.usernames ? new Map([...Object.entries(item.usernames), ...memberNames]) : memberNames
    const sentence = actText(item, { teamNames, memberNames: people }, named)
    const actingFor = item.acting_as_team_id ? teamNames.get(item.acting_as_team_id) : undefined
    const marked = actingFor && !named.has(actingFor) ? `${sentence} (for ${actingFor})` : sentence
    const actorUsername = text(item.actor.username)
    return {
      id: item.id,
      actor: actorUsername ?? COMMISH_LOG_UNNAMED_ACTOR,
      actorUsername,
      text: plainText(marked),
      marked,
      reason: text(item.reason)?.trim() ?? null,
      createdAt: item.created_at,
    }
  })
}

/** Every string inside a receipt's JSON, with the username marks removed (R1403). */
function unmarked(value: unknown): unknown {
  if (typeof value === 'string') return stripMarks(value)
  if (Array.isArray(value)) return value.map(unmarked)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [stripMarks(key), unmarked(inner)]))
  }
  return value
}

/** user id → username, from the league detail's members (a placeholder seat has no user). */
export function memberNamesOf(members: ReadonlyArray<{ user_id: string | null; profiles: { username: string } | null }>): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of members) {
    if (m.user_id && m.profiles?.username) map.set(m.user_id, m.profiles.username)
  }
  return map
}
