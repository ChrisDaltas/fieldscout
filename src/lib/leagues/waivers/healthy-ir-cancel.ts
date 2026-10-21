/**
 * Cancel the pending waiver claims of every team that has a player who isn't
 * IR-eligible in an IR spot — as soon as we know (PROGRESS D593 / F693;
 * migration 205's `waiver_claims_cancel_healthy_ir` door; spec §13.2).
 *
 * Chris, 2026-10-21, verbatim: "No, if the player is no longer IR eligible
 * the claims are cancelled."
 *
 * The hourly `sync-weekly-projections` run (which keeps injury tags fresh —
 * D592) and the daily `sync-players` run call this with the service role
 * right after they write `players`. The door does the work in the database
 * (one cancel shared with the waiver run, which stays the backstop): it is
 * idempotent and sends each team's manager ONE notice, so calling it every
 * hour is safe. This file only calls it with the injected instant (the
 * TimeProvider seam, D3) and reads its answer — loudly:
 *   - the door's counts are asserted (its total equals the sum of the
 *     leagues it names) — a report that doesn't add up is a failure;
 *   - a door that is not on the database yet (PGRST202 naming it — migration
 *     205 deploys before Chris's `db push`) is a named WARNING with
 *     `deployed: false`, never a failure and never a quiet zero;
 *   - any other error is a failure, named.
 */
import type { TimeProvider } from '@/lib/leagues/time/time-provider'
import type { SyncClient } from '@/lib/sync/types'

export const HEALTHY_IR_CANCEL_DOOR = 'waiver_claims_cancel_healthy_ir'

export const HEALTHY_IR_CANCEL_NOT_DEPLOYED =
  'healthy-IR claim cancel: the waiver_claims_cancel_healthy_ir door is not on this database yet (migration 205 not pushed) — nothing cancelled; the waiver run cancels them once it is'

export interface HealthyIrCancelLeague {
  league_id: string
  teams: number
  cancelled: number
  notified: number
}

export interface HealthyIrCancelReport {
  /** False when the call or its answer failed (named in `failures`). */
  ok: boolean
  /** False when the door isn't on this database yet (named in `warnings`). */
  deployed: boolean
  paused: boolean
  leaguesChecked: number
  cancelled: number
  notified: number
  /** The leagues that cancelled at least one claim. */
  leagues: HealthyIrCancelLeague[]
  /** Leagues the door skipped, each with why (a league with no week at the instant). */
  skipped: Array<{ league_id: string; why: string }>
  /** The door's own why for a zero ("no_pending_claims — …", "none_blocked — …", the pause). */
  why: string | null
  warnings: string[]
  failures: string[]
}

function empty(): HealthyIrCancelReport {
  return { ok: true, deployed: true, paused: false, leaguesChecked: 0, cancelled: 0, notified: 0, leagues: [], skipped: [], why: null, warnings: [], failures: [] }
}

function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The door's "no such function" — anchored on its name, so another missing
 *  function never reads as "not pushed yet". */
export function isDoorMissing(error: { code?: string; message?: string } | null): boolean {
  return error !== null && error.code === 'PGRST202' && (error.message ?? '').includes(HEALTHY_IR_CANCEL_DOOR)
}

export async function cancelHealthyIrClaims(db: SyncClient, time: TimeProvider): Promise<HealthyIrCancelReport> {
  const report = empty()
  const { data, error } = await db.rpc(HEALTHY_IR_CANCEL_DOOR, { p_now: time.now().toISOString() })
  if (error) {
    if (isDoorMissing(error)) {
      report.deployed = false
      report.warnings.push(HEALTHY_IR_CANCEL_NOT_DEPLOYED)
      return report
    }
    report.ok = false
    report.failures.push(`healthy-IR claim cancel: ${HEALTHY_IR_CANCEL_DOOR} failed — ${error.message}`)
    return report
  }
  if (!isRecord(data)) {
    report.ok = false
    report.failures.push(`healthy-IR claim cancel: ${HEALTHY_IR_CANCEL_DOOR} answered ${JSON.stringify(data)} — no report; refusing to call that done`)
    return report
  }
  report.paused = data.paused === true
  report.why = typeof data.why === 'string' ? data.why : null
  const checked = int(data.leagues_checked)
  const cancelled = int(data.cancelled)
  const notified = int(data.notified)
  if (checked === null || cancelled === null || notified === null) {
    report.ok = false
    report.failures.push(`healthy-IR claim cancel: the door's report has no counts (${JSON.stringify(data)}) — refusing to call that done`)
    return report
  }
  report.leaguesChecked = checked
  report.cancelled = cancelled
  report.notified = notified
  for (const l of Array.isArray(data.leagues) ? data.leagues : []) {
    if (!isRecord(l) || typeof l.league_id !== 'string') continue
    report.leagues.push({ league_id: l.league_id, teams: int(l.teams) ?? 0, cancelled: int(l.cancelled) ?? 0, notified: int(l.notified) ?? 0 })
  }
  for (const s of Array.isArray(data.skipped) ? data.skipped : []) {
    if (isRecord(s) && typeof s.league_id === 'string') report.skipped.push({ league_id: s.league_id, why: typeof s.why === 'string' ? s.why : 'unknown' })
  }
  // Asserted, not trusted: the total is the sum of the leagues it names.
  const sumCancelled = report.leagues.reduce((n, l) => n + l.cancelled, 0)
  const sumNotified = report.leagues.reduce((n, l) => n + l.notified, 0)
  if (sumCancelled !== cancelled || sumNotified !== notified) {
    report.ok = false
    report.failures.push(
      `healthy-IR claim cancel: the door reports ${cancelled} cancelled / ${notified} notified but its leagues add up to ${sumCancelled} / ${sumNotified} — refusing to call that done`,
    )
  }
  for (const s of report.skipped) report.warnings.push(`healthy-IR claim cancel: league ${s.league_id} skipped — ${s.why}`)
  if (report.paused && report.why) report.warnings.push(`healthy-IR claim cancel: ${report.why}`)
  return report
}
