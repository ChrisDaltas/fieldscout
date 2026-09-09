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

import { createClient } from '@supabase/supabase-js'

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
/** Per-sample bar for a REALTIME round trip (fresh channel SUBSCRIBE + a
 *  broadcast echoed back to the same client). An idle local stack does this
 *  in ~5-30ms (measured on an idle stack 2026-09-08), so 1s is ~30x head-room
 *  while still discriminating a stack that answers but slowly; the F56 shape
 *  is a subscribe/delivery that never completes at all, which the ABORT
 *  catches. Falsified against a closed port: `realtime subscribe status
 *  CHANNEL_ERROR`. */
const REALTIME_BUDGET_MS = 1_000
/** Per-round-trip abort bar (a channel that never joins is a failed sample). */
const REALTIME_TIMEOUT_MS = 8_000
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

/**
 * THE REALTIME HALF — added at L.D6.3 because F56's own tripwire was BLIND to
 * the thing F56 is about.
 *
 * MEASURED 2026-09-08 in the first end-to-end `test:gate:m4` run: the settle
 * sampled PostgREST at 17/6/13/13/10 ms — an idle stack by any reading — and
 * reported "settled after 5 samples"; the very next stage then failed at
 * `auction-live.spec.ts:206` on
 * `locator('header[aria-label="Draft command bar"]').getByText(/^Draft live$/)`
 * not visible in 30 s, which is F56's recorded post-R399 signature VERBATIM,
 * and the same spec passed standalone in 43 s minutes later on the same tree.
 *
 * F56's row promised that "if it recurs, the settle is the tripwire that turns
 * a 30 s Playwright timeout mystery into a named, sampled stack-health failure
 * at the stage boundary". It did not, and it could not: the REST probe
 * measures PostgREST, while the failure is a REALTIME subscribe/delivery that
 * never completes. A gate that waits on the wrong protocol is a blind sleep
 * wearing a diagnosis.
 *
 * So each sample now round-trips REALTIME too: a FRESH channel is subscribed
 * (the manager page's own first act on entering a room) and a broadcast is
 * echoed back to the same client (the lobby->live flip's own delivery path).
 * Both halves must be OK for a sample to count, and the consecutive counter
 * resets on either.
 */
async function sampleRealtime(): Promise<{ ok: boolean; detail: string }> {
  const started = Date.now()
  const client = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 20 } },
  })
  const channel = client.channel(`gate-settle-${started}-${Math.floor(Math.random() * 1e6)}`, {
    config: { broadcast: { self: true } },
  })
  try {
    const outcome = await new Promise<{ ok: boolean; detail: string }>((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          ok: false,
          detail: `realtime round trip did not complete in ${REALTIME_TIMEOUT_MS}ms (subscribe or delivery never landed)`,
        })
      }, REALTIME_TIMEOUT_MS)
      const done = (result: { ok: boolean; detail: string }): void => {
        clearTimeout(timer)
        resolve(result)
      }
      channel.on('broadcast', { event: 'settle' }, () => {
        const latency = Date.now() - started
        if (latency > REALTIME_BUDGET_MS) {
          done({ ok: false, detail: `realtime echoed but in ${latency}ms > ${REALTIME_BUDGET_MS}ms budget` })
          return
        }
        done({ ok: true, detail: `realtime subscribe+echo in ${latency}ms` })
      })
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.send({ type: 'broadcast', event: 'settle', payload: { at: started } })
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          done({ ok: false, detail: `realtime subscribe status ${status} after ${Date.now() - started}ms` })
        }
      })
    })
    return outcome
  } finally {
    try {
      await client.removeChannel(channel)
    } catch {
      /* the sample already reported; teardown noise is not a signal */
    }
    try {
      client.realtime.disconnect()
    } catch {
      /* idem */
    }
  }
}

async function main(): Promise<void> {
  console.log(
    `[gate-settle] F56 bounded stack-health settle: need ${CONSECUTIVE_OK_REQUIRED} consecutive ` +
      `OK samples — REST draft-state (200 + <${LATENCY_BUDGET_MS}ms) AND a REALTIME subscribe+echo ` +
      `(<${REALTIME_BUDGET_MS}ms) — budget ${TOTAL_BUDGET_MS / 1000}s`,
  )
  const deadline = Date.now() + TOTAL_BUDGET_MS
  const trail: string[] = []
  let consecutive = 0
  let sampleNo = 0
  while (Date.now() < deadline) {
    sampleNo += 1
    const rest = await sampleDraftState()
    // The REALTIME half is sampled even when REST already failed, so the trail
    // says which protocol was unhealthy rather than only that something was.
    const realtime = await sampleRealtime()
    const ok = rest.ok && realtime.ok
    consecutive = ok ? consecutive + 1 : 0
    const line =
      `[gate-settle] sample ${sampleNo}: ${rest.detail} · ${realtime.detail} — consecutive OK: ${consecutive}`
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
      `samples (REST draft-state AND a REALTIME subscribe+echo) within ${TOTAL_BUDGET_MS / 1000}s ` +
      `of the previous stage ending. This is the F56 post-load contention family presenting at the ` +
      `settle rather than inside a spec — read the trail below for WHICH protocol was unhealthy, ` +
      `investigate the stack (docker stats, supabase logs), do NOT retry the gate blind.`,
  )
  console.error(trail.join('\n'))
  process.exit(1)
}

void main()
