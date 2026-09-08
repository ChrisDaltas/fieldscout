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

export interface FeedLine {
  id: string
  kind: 'transaction' | 'system'
  /** The one-line sentence. */
  text: string
  /** The team the move belongs to, by name (null for a system post). */
  team: string | null
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
