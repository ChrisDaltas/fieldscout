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
 * Landed with L.D1.9's triggers (D296; migration 119): `transactions`
 * (INSERT — the activity feed's carrier), `matchups` (a per-STATEMENT
 * summary on INSERT / UPDATE / DELETE — the UPDATE is the coalesced
 * `scores_updated`: ONE event per league per worker batch; INSERT/DELETE
 * carry a Remix or a bracket (re)build), `team_week_results` (a per-
 * statement summary — finalization, the rebuild, the door's provisional
 * rows) and `league_weeks` (row UPDATE OF status). They were listed here
 * BEFORE their triggers existed (L.D4.2) so the feed started moving the
 * moment the triggers landed.
 *
 * Also landed with 119 (D319(6), F252(a)): `league_player_pool` — NOT a
 * table trigger but ONE coalesced per-league summary `lineup_lock_tick`
 * sends per pass that changed ≥ 1 pool row (a kickoff or a release
 * instant): `{operation: 'UPDATE', record: {season, week, changed, at}}`.
 * Its first subscriber is `use-rosters` (the 🔒 the lineup editor renders),
 * which is why the name joins the closed set; L.D5.1's 60 s poll can retire
 * (F259(a)).
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
  'league_player_pool',
  // Landed with 120 (L.D1.10's #266 fix round, R856; F42 discharged for
  // teams): `teams` UPDATE — a per-STATEMENT, diff-aware summary
  // (`{count, teams: [{id, name, status, retired_at_week,
  // successor_team_id}]}`; one event per league per statement that changed
  // one of those four columns — a retirement's seal, a vacate, a claim of an
  // orphaned seat, a rename; never owner_id / manager identity). Its first
  // subscribers are `use-standings` (a retirement flips the standings order
  // and the row set, and nothing else on this wire invalidates them) and,
  // through the same hook, the league detail's teams list.
  'teams',
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
 *
 * `teams` (120 — R856) is the third carrier: a franchise RETIREMENT changes
 * the standings without touching a final row — the retired franchise's
 * row disappears (117's seated CTE) and its record folds into the
 * successor's line for seeding, which can flip the order (068 D1). An h2h
 * retirement emits nothing else this list names (`league_rosters` /
 * `matchups` / `transactions` are not standings carriers), so without
 * `teams` a member's open standings page kept the retired row and the
 * pre-flip order until a reload — measured (R856). A `teams` event fires
 * once per statement that changed a rendered column (a seal, a vacate, a
 * claim, a rename) — rare, and never on a score tick.
 */
export const STANDINGS_INVALIDATING_EVENTS: readonly LeagueChannelEvent[] = [
  'team_week_results',
  'league_weeks',
  'teams',
]

export function standingsEventInvalidates(name: string): boolean {
  return (STANDINGS_INVALIDATING_EVENTS as readonly string[]).includes(name)
}

/**
 * Which events make the PROJECTED standings stale (§11.5 v2.16.25 —
 * `league_standings_projected`, migration 118; M4 task L.D5.5).
 *
 * The projected table is, by definition, the LIVE picture: the open weeks
 * derived "as if they ended now" from the write door's provisional scores
 * (D318(3)). So — unlike the FINAL table above — `matchups` IS a carrier:
 * 119's coalesced `scores_updated` (ONE event per league per worker batch,
 * never per player) moves the projection every time the door writes. The
 * cost is one member-gated scan per open PROJECTED view per batch — the
 * matchup page's own cadence (D323), and only while a viewer has the
 * projected view selected (the hook's query is `enabled` by the control).
 * `team_week_results` / `league_weeks` (a finalization folds a week from
 * the projected set into the final set) and `teams` (a retirement — R856)
 * are the final table's carriers and are carriers here for the same
 * reasons. Widen this to `league_chat` / `transactions` and the projection
 * really does refetch on every chat line.
 */
export const PROJECTED_STANDINGS_INVALIDATING_EVENTS: readonly LeagueChannelEvent[] = [
  'matchups',
  'team_week_results',
  'league_weeks',
  'teams',
]

export function projectedStandingsEventInvalidates(name: string): boolean {
  return (PROJECTED_STANDINGS_INVALIDATING_EVENTS as readonly string[]).includes(name)
}

/**
 * Which events make the PLAYOFF BRACKET stale (§11.5's Playoffs bullet
 * v2.16.25 / Q39 (E); `league_playoff_bracket`, migration 118; M4 task
 * L.D5.5).
 *
 * 118/119 emit NO bracket event of their own (D318(8) — checked at L.D5.5:
 * the sync writes `matchups` rows and flips `leagues.status`, and both of
 * those tables already broadcast). So the bracket refetches on the events
 * the rollover and its consequences already emit:
 *   - `league_weeks` — the rollover ITSELF: 116's (b) flips `live →
 *     correction_window` at `nfl_weeks.last_game_ends_at`, the instant the
 *     sync (re)builds a round;
 *   - `matchups` — the (re)build's DELETE + INSERT (119's per-statement
 *     trigger; F256(h) ✅ by 119) AND the coalesced score tick, which moves
 *     the PROJECTED round 1 (it is seeded from the projected table) and a
 *     built round's two-week totals;
 *   - `team_week_results` — a finalization (the correction close, where a
 *     moved seed REBUILDS the round and `source` flips to `final`);
 *   - `leagues` — 070's status broadcast: `in_season → playoffs` with the
 *     first bracket write, `playoffs → complete` with the champion;
 *   - `teams` — a retirement changes the projected seeding (R856).
 * The same one-per-batch cadence as the projected table; `league_chat` /
 * `transactions` / `league_rosters` / `league_player_pool` move no pairing.
 */
export const PLAYOFF_BRACKET_INVALIDATING_EVENTS: readonly LeagueChannelEvent[] = [
  'matchups',
  'team_week_results',
  'league_weeks',
  'leagues',
  'teams',
]

export function playoffBracketEventInvalidates(name: string): boolean {
  return (PLAYOFF_BRACKET_INVALIDATING_EVENTS as readonly string[]).includes(name)
}

/**
 * Which events make the LEAGUE DETAIL (`useLeague` — §15.1's GET, the
 * `teams` list the standings page names rows from and the members list)
 * stale. Only `teams` (120 — R856): a retirement seals one franchise and
 * mints its successor, and the detail's teams list carried NO channel
 * invalidation at all before this (measured). `leagues` (070 — the
 * league's own status / name / avatar) is deliberately NOT here yet: no
 * consumer subscribes the detail to it today, and adding it belongs to
 * whichever surface first needs a live league header (a note, not a
 * silent widening — R773's rule that the predicate SELECTS the events).
 */
export const LEAGUE_DETAIL_INVALIDATING_EVENTS: readonly LeagueChannelEvent[] = ['teams']

export function leagueDetailEventInvalidates(name: string): boolean {
  return (LEAGUE_DETAIL_INVALIDATING_EVENTS as readonly string[]).includes(name)
}

/**
 * Which events make the ROSTERS stale (§12.7/§13.1).
 *
 * `league_rosters` (072 — LIVE TODAY, INSERT/UPDATE: a set_lineup's
 * `slot_key` write, a move's add row, an IR placement) is the roster's own
 * carrier; `transactions` (119) is the move itself — a DROP is a DELETE
 * on `league_rosters`, which 072's trigger does not broadcast, so without
 * `transactions` a dropped player would stay on the rendered roster until a
 * rejoin; `league_player_pool` (119 — the tick's ONE coalesced summary per
 * league per pass that changed a lock, D319(6)) is the 🔒 itself — the
 * `game_lock` the rosters route derives from `league_player_pool.locked_until`
 * — so a kickoff reaches an open lineup editor without the F252 poll. All
 * three are needed; a score tick is not.
 */
export const ROSTERS_INVALIDATING_EVENTS: readonly LeagueChannelEvent[] = [
  'league_rosters',
  'transactions',
  'league_player_pool',
]

export function rostersEventInvalidates(name: string): boolean {
  return (ROSTERS_INVALIDATING_EVENTS as readonly string[]).includes(name)
}

/**
 * Which events make the SCHEDULE stale (§11.7/D298 — M4 task L.D5.3).
 *
 * `matchups` (119's per-statement trigger: a score tick, a status flip, AND
 * a Remix's or a bracket (re)build's DELETE + INSERT — one event per
 * statement) and `league_weeks` (the status ladder the grid renders beside
 * every week) are the schedule's own carriers. `league_chat` WAS the
 * stand-in a Remix or a matchup edit had before 119 (111's D97 system post
 * broadcast in the same transaction — D317(4), F253(e)/F254(a)); the
 * `matchups` trigger now carries the rows themselves, so the chat arm is
 * gone: a chat line no longer re-reads two member tables for every open
 * schedule page. `team_week_results` (finalization — standings' business),
 * `transactions`, `league_rosters`, `league_player_pool` and `leagues` do
 * not move a pairing.
 */
export const SCHEDULE_INVALIDATING_EVENTS: readonly LeagueChannelEvent[] = [
  'matchups',
  'league_weeks',
]

export function scheduleEventInvalidates(name: string): boolean {
  return (SCHEDULE_INVALIDATING_EVENTS as readonly string[]).includes(name)
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

/**
 * Two (or more) derived handler maps joined for ONE subscriber — an event
 * that appears in several maps runs each of its handlers, in map order;
 * an event in none gets no handler (still inert by construction). The
 * standings hook uses it (120 / R856): its standings map and the league-
 * detail map both name `teams`, so one event refetches both queries, while
 * `team_week_results` / `league_weeks` stay standings-only. Kept as a plain
 * function so the composition is executable in node (`use-matchups-ops.test.ts`).
 */
export function mergeHandlers(
  ...maps: ReadonlyArray<Partial<Record<LeagueChannelEvent, () => void>>>
): Partial<Record<LeagueChannelEvent, () => void>> {
  const merged: Partial<Record<LeagueChannelEvent, () => void>> = {}
  for (const event of LEAGUE_CHANNEL_EVENTS) {
    const fns = maps.map((m) => m[event]).filter((fn): fn is () => void => typeof fn === 'function')
    if (fns.length === 0) continue
    merged[event] = () => {
      for (const fn of fns) fn()
    }
  }
  return merged
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
