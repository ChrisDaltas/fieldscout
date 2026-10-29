/**
 * room-watchdog — the draft room's watchdog rule as drill 1's room model
 * runs it (M7 L.F2.3; `realtime-kill-db.test.ts`; PROGRESS D761 / D766).
 *
 * The app's own rule is `roomWatchdogWantsRefetch` in
 * `src/hooks/use-draft-ops.ts`. It is MIRRORED here, not imported: that
 * module's type imports would pull the whole draft-room hook tree into the
 * stack lane's import closure (F290). `room-model-pin.test.ts` (the fast
 * lane) calls BOTH over every branch — scheduled, live with a recent beat,
 * live past the silence, live before any beat, paused, complete, no row —
 * and fails the moment they disagree.
 */

/** `use-draft-ops.ts` `ROOM_WATCHDOG_MS` — the watchdog's beat. */
export const ROOM_WATCHDOG_MS = 5_000
/** `use-draft-ops.ts` `HEARTBEAT_SILENCE_MS` — silence that is doubt for a live room. */
export const ROOM_HEARTBEAT_SILENCE_MS = 45_000

/** Does this watchdog beat owe the room a refetch? (The model's copy of the app's rule.) */
export function modelWatchdogWantsRefetch(input: { status: string | null | undefined; lastBeatAtMs: number | null; nowMs: number }): boolean {
  const { status, lastBeatAtMs, nowMs } = input
  if (status === 'scheduled') return true // a scheduled room emits no beats: ask
  if (status !== 'live') return false // paused, complete, no row: inert
  return lastBeatAtMs !== null && nowMs - lastBeatAtMs > ROOM_HEARTBEAT_SILENCE_MS
}
