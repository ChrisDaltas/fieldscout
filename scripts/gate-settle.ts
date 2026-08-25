/**
 * gate-settle.ts — the F56 bounded stack-health settle (L.C6.1 item 2).
 *
 * WHY THIS EXISTS (PROGRESS F56, gate-settle half): the M2 gate's first
 * full run (2026-08-14) and both of the DR-era reviewer runs (R400) saw
 * the E2E stage choke when it started ~60–90s after the sim's broadcast
 * burst + cascade cleanup sweep — the manager page never received the
 * lobby→live broadcast within 30s under post-sim load, while the same
 * spec passed standalone on the same tree. The row's own recommendation,
 * implemented here verbatim: interpose a BOUNDED stack-health settle
 * between the sim and E2E stages — "poll until N consecutive OK
 * draft-state responses — a diagnosed wait, never a blind sleep."
 *
 * The probe is the app's own read shape (a PostgREST draft-state query,
 * the same REST path every room fetch takes), and health means BOTH
 * halves of an OK response:
 *   - HTTP 200 (the stack answers), and
 *   - latency under LATENCY_BUDGET_MS (the stack answers LIKE AN IDLE
 *     STACK — an idle local PostgREST answers this query in ~10–50ms, so
 *     400ms is generous headroom while still discriminating the
 *     post-burst contention F56 observed, where responses stretch to
 *     seconds or time out).
 *
 * Diagnosed, not blind: every sample is logged (status + latency), the
 * consecutive-OK counter resets on any failure, and exhausting the
 * budget FAILS the gate loudly with the full sample trail — never a
 * sleep that hides the condition it was waiting out.
 *
 * Local-stack only (the R207 contract): coordinates are the standard
 * local-dev demo values, overridable via SUPABASE_LOCAL_*, and nothing
 * here reads .env.local.
 */

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

/** N consecutive OK draft-state responses — F56's own wording. */
const CONSECUTIVE_OK_REQUIRED = 5
/** Per-sample latency bar for "OK" (an idle stack answers in ~10–50ms). */
const LATENCY_BUDGET_MS = 400
/** Per-request abort bar (a hung response is a failed sample, not a hang). */
const REQUEST_TIMEOUT_MS = 5_000
/** Sample cadence. */
const SAMPLE_INTERVAL_MS = 1_000
/** Total budget — bounded (F56: "a diagnosed wait, never a blind sleep"). */
const TOTAL_BUDGET_MS = 120_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sampleDraftState(): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const started = Date.now()
  try {
    const res = await fetch(`${LOCAL_URL}/rest/v1/drafts?select=id,status&limit=1`, {
      headers: {
        apikey: LOCAL_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}`,
      },
      signal: controller.signal,
    })
    const latency = Date.now() - started
    // Drain the body so the connection is reusable and the read is real.
    await res.text()
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} in ${latency}ms` }
    if (latency > LATENCY_BUDGET_MS) {
      return { ok: false, detail: `HTTP 200 but ${latency}ms > ${LATENCY_BUDGET_MS}ms budget` }
    }
    return { ok: true, detail: `HTTP 200 in ${latency}ms` }
  } catch (err) {
    const latency = Date.now() - started
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, detail: `request failed after ${latency}ms (${message})` }
  } finally {
    clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  console.log(
    `[gate-settle] F56 bounded stack-health settle: need ${CONSECUTIVE_OK_REQUIRED} consecutive ` +
      `OK draft-state responses (200 + <${LATENCY_BUDGET_MS}ms), budget ${TOTAL_BUDGET_MS / 1000}s`,
  )
  const deadline = Date.now() + TOTAL_BUDGET_MS
  const trail: string[] = []
  let consecutive = 0
  let sampleNo = 0
  while (Date.now() < deadline) {
    sampleNo += 1
    const { ok, detail } = await sampleDraftState()
    consecutive = ok ? consecutive + 1 : 0
    const line = `[gate-settle] sample ${sampleNo}: ${detail} — consecutive OK: ${consecutive}`
    trail.push(line)
    console.log(line)
    if (consecutive >= CONSECUTIVE_OK_REQUIRED) {
      console.log(`[gate-settle] stack settled after ${sampleNo} samples — proceeding to E2E`)
      return
    }
    await sleep(SAMPLE_INTERVAL_MS)
  }
  console.error(
    `[gate-settle] FAILED: the stack never produced ${CONSECUTIVE_OK_REQUIRED} consecutive OK ` +
      `draft-state responses within ${TOTAL_BUDGET_MS / 1000}s of the sim stage ending. This is ` +
      `the F56 post-load contention family presenting at the settle rather than inside a spec — ` +
      `investigate the stack (docker stats, supabase logs), do NOT retry the gate blind.`,
  )
  console.error(trail.join('\n'))
  process.exit(1)
}

void main()
