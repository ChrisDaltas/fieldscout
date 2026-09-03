/**
 * Pure helpers for the `league:<id>` realtime spine (M4 task L.D4.2;
 * spec §9.2/§9.3, PROGRESS D296/D298).
 *
 * The `-ops` split is the house pattern (`use-draft-ops.ts`,
 * `use-draft-chat-ops.ts`): everything decidable without a socket lives here
 * so it can be node-tested, and `use-league-channel.ts` keeps only the
 * transport.
 */

/**
 * The CLOSED set of broadcast events the `league:<id>` topic carries.
 *
 * Landed today (migration 070): `leagues` (UPDATE) and `league_chat`
 * (INSERT — a post whose `context` is not `draft:<id>` broadcasts to
 * `league:<league_id>`, 070:289).
 *
 * Arriving with migration 117 / L.D1.9 (D296): `transactions` (INSERT — the
 * activity feed's carrier), `matchups` (UPDATE — the coalesced
 * `scores_updated`), `team_week_results` (finalization) and `league_weeks`
 * (status flips). They are listed here BEFORE their triggers exist on
 * purpose: registering the listener now costs nothing, and it means the
 * feed starts moving the moment 117 lands rather than needing this file
 * edited again.
 */
export const LEAGUE_CHANNEL_EVENTS = [
  'leagues',
  'league_chat',
  'transactions',
  'matchups',
  'team_week_results',
  'league_weeks',
] as const

export type LeagueChannelEvent = (typeof LEAGUE_CHANNEL_EVENTS)[number]

/** §9.2's topic string. One place, so a typo cannot half-work. */
export function leagueChannelTopic(leagueId: string): string {
  return `league:${leagueId}`
}

/** supabase-js prefixes the registry key; the stale-instance sweep in the
 *  spine matches on this (the D109(9) hazard: subscribing a mid-teardown
 *  instance wedges the rejoin forever). */
export function leagueChannelRegistryTopic(leagueId: string): string {
  return `realtime:${leagueChannelTopic(leagueId)}`
}

/*
 * Forward compatibility (the M2 pattern) has no runtime helper here, on
 * purpose. An event this build does not know is INERT **by construction**:
 * the spine binds only `LEAGUE_CHANNEL_EVENTS` members and every dispatch is
 * an optional call into a caller's handler map, so an unbound event reaches
 * nothing and a bound one with no handler does nothing.
 *
 * There WAS an `isLeagueChannelEvent(name)` type guard, and the spine called
 * it on a value it had just drawn from `LEAGUE_CHANNEL_EVENTS` — a check
 * that could not fail, reading like enforcement. **R773 removed it** under
 * D272(20) ("a probe that cannot fail is replaced and said"). The constant's
 * own pins (the exact list, its case-sensitivity, and that no sensitive
 * table is on it) are what carry the claim now. Re-add a guard only where a
 * genuinely unknown string can arrive — a wildcard binding, say — and pin it
 * there.
 */

/**
 * Which events make the ACTIVITY feed stale (§13.4's M4 slice, D298).
 *
 * **Load-bearing, not documentation (R773):** `use-league-activity` BUILDS
 * its handler map by filtering `LEAGUE_CHANNEL_EVENTS` through
 * `activityEventInvalidates`, so an event this predicate rejects gets no
 * handler at all. Add `matchups` here and the feed really does start
 * refetching on every score tick; remove `transactions` and a completed move
 * really does stop refreshing the feed.
 *
 * `transactions` is the feed's own carrier (D296 — the F42 trigger's
 * consumer). `league_chat` is the other half of the feed: the D97
 * in-transaction system posts that 111/112 write for commissioner actions
 * already broadcast on this topic today (070), so a Remix confirmed in one
 * browser reaches another member's open feed without 117.
 *
 * Everything else — `matchups`, `team_week_results`, `league_weeks`,
 * `leagues` — is L.D4.1's/L.D5's business and does NOT invalidate the feed:
 * a score tick every few seconds must not re-fetch the activity list.
 */
export const ACTIVITY_INVALIDATING_EVENTS: readonly LeagueChannelEvent[] = [
  'transactions',
  'league_chat',
]

export function activityEventInvalidates(name: string): boolean {
  return (ACTIVITY_INVALIDATING_EVENTS as readonly string[]).includes(name)
}

/** Reconnect backoff, capped — the `use-draft.ts:297` curve, extracted so it
 *  is pinnable rather than an inline expression. */
export const LEAGUE_CHANNEL_MAX_REOPEN_MS = 15_000

export function reopenDelayMs(attempt: number): number {
  const safe = attempt < 0 ? 0 : Math.min(attempt, 31)
  return Math.min(1_000 * 2 ** safe, LEAGUE_CHANNEL_MAX_REOPEN_MS)
}

/** The envelope 070 emits: `{ operation, record }` under the table's event
 *  name. Payloads are column-selected DB-side (§9.2 — never scores by
 *  player, never claim data); this type deliberately does not promise more
 *  than "some columns arrived". */
export interface LeagueBroadcastEnvelope {
  operation?: string
  record?: Record<string, unknown> | null
}
