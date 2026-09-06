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
  // Landed since 072 (M2, L.B1.7(3b)): `league_rosters` INSERT/UPDATE
  // broadcasts `{operation, record: {id, team_id, player_id, slot_key,
  // acquisition_type, acquired_at}}` on `league:<league_id>` — column-
  // selected, no cost/bid data. Its FIRST subscriber is L.D4.1's
  // `use-rosters` (M4), which is why the name joins the closed set here and
  // not earlier.
  'league_rosters',
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

/*
 * L.D4.1's three read surfaces, each with its OWN pure predicate in the
 * R773 shape — the hook DERIVES its handler map by filtering
 * `LEAGUE_CHANNEL_EVENTS` through the predicate, so the predicate SELECTS
 * the events and dropping a name here really does stop the refetch (the
 * task's DoD probe). Freshness is D298's mechanism throughout: broadcast +
 * refetch-on-event, never a cache patch (D296's payloads are column-selected
 * and cannot reconstruct a row).
 */

/**
 * Which events make a WEEK'S MATCHUPS stale (§11.4/D296/D298).
 *
 * `matchups` (UPDATE — the coalesced `scores_updated` carrier, L.D1.9's
 * trigger: ONE event per league per worker batch) is the live-score tick;
 * `team_week_results` is finalization writing the week's results; and
 * `league_weeks` is the status flip (`live` → `correction_window` → `final`)
 * that moves the `final (pending corrections)` badge (§16.5.4). The
 * matchups HOOK narrows further by week through `matchupsEventEffect`
 * (`use-matchups-ops.ts`) — an event that names another week is inert.
 * `league_rosters` / `transactions` / `league_chat` / `leagues` do not touch
 * a week's scores and are not here.
 */
export const MATCHUPS_INVALIDATING_EVENTS: readonly LeagueChannelEvent[] = [
  'matchups',
  'team_week_results',
  'league_weeks',
]

export function matchupsEventInvalidates(name: string): boolean {
  return (MATCHUPS_INVALIDATING_EVENTS as readonly string[]).includes(name)
}

/**
 * Which events make the STANDINGS stale (§11.5/D297/D314).
 *
 * `league_standings` (117) reads FINAL `team_week_results` rows only — the
 * live projection is the UI's (L.D5.3) over the write door's provisional
 * cells, and the RPC never reads a provisional row. So the standings CHANGE
 * exactly when a week finalizes: `team_week_results` (the results written
 * final) and `league_weeks` (the `final` flip). **`matchups` is deliberately
 * NOT here**: a score tick every few seconds cannot change a table that
 * reads only final rows, and refetching a SECURITY DEFINER scan for every
 * member on every tick is the exact waste D310(4) refused for the activity
 * feed. Widen this and standings really do start refetching on every tick.
 */
export const STANDINGS_INVALIDATING_EVENTS: readonly LeagueChannelEvent[] = [
  'team_week_results',
  'league_weeks',
]

export function standingsEventInvalidates(name: string): boolean {
  return (STANDINGS_INVALIDATING_EVENTS as readonly string[]).includes(name)
}

/**
 * Which events make the ROSTERS stale (§12.7/§13.1).
 *
 * `league_rosters` (072 — LIVE TODAY, INSERT/UPDATE: a set_lineup's
 * `slot_key` write, a move's add row, an IR placement) is the roster's own
 * carrier; `transactions` (L.D1.9) is the move itself — a DROP is a DELETE
 * on `league_rosters`, which 072's trigger does not broadcast, so without
 * `transactions` a dropped player would stay on the rendered roster until a
 * rejoin. Both are needed; a score tick is not.
 */
export const ROSTERS_INVALIDATING_EVENTS: readonly LeagueChannelEvent[] = [
  'league_rosters',
  'transactions',
]

export function rostersEventInvalidates(name: string): boolean {
  return (ROSTERS_INVALIDATING_EVENTS as readonly string[]).includes(name)
}

/**
 * The R773 shape as ONE function: a handler map DERIVED from a predicate
 * over the closed event set, every admitted event bound to the same
 * `invalidate`. A consumer passes the result to `useLeagueChannel`, so the
 * predicate is load-bearing — an event it rejects gets no handler, and the
 * spine dispatches nothing for it (unknown events inert by construction).
 * Exported as a plain function so the wiring is EXECUTABLE in node through
 * `joinLeagueRoom` with the client mocked (`use-matchups-ops.test.ts`), not
 * only source-pinned.
 */
export function invalidatingHandlers(
  invalidates: (name: string) => boolean,
  invalidate: () => void,
): Partial<Record<LeagueChannelEvent, () => void>> {
  const handlers: Partial<Record<LeagueChannelEvent, () => void>> = {}
  for (const event of LEAGUE_CHANNEL_EVENTS.filter(invalidates)) {
    handlers[event] = invalidate
  }
  return handlers
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
