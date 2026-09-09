import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Page, TestInfo } from '@playwright/test'

import { readAuctionMarket, readBidLedger, readPlayerFullName, type Supabase } from './harness'

/**
 * FAILURE-EVIDENCE INSTRUMENTS FOR THE TWO-CONTEXT DRAFT SPECS — F308.
 *
 * **Why this file exists, stated as the gap it closes.** `test:gate:m4`'s
 * first end-to-end run died at `auction-live.spec.ts:213` (the nomination
 * broadcast) 2,644 s in, and the session that took the row could establish
 * NOTHING about the mechanism. Three reasons were recorded; ONE OF THEM IS
 * FALSE, and correcting it is part of this file's job (D334):
 *
 *  1. **"No trace existed, because `trace: 'retain-on-failure'` applies only
 *     to the default fixtures, and this spec builds both contexts by hand."**
 *     **MEASURED FALSE (2026-09-09, playwright 1.62.1.)** The `_setupArtifacts`
 *     auto-fixture hooks `didCreateBrowserContext` for EVERY context created
 *     during a test — `index.js:150` → `_startTraceChunkOnContextCreation`,
 *     which calls `tracing.start(...)` on a context that has none — so a
 *     hand-built `browser.newContext()` IS traced. Proven by execution: an
 *     explicit `context.tracing.start()` added here failed with *"Tracing has
 *     been already started"*, and the retained `trace.zip` carries FOUR
 *     sub-traces (`0-trace` … `3-trace`), i.e. both contexts.
 *     **The real mechanism is destruction, not absence:** playwright clears
 *     `test-results/` at the start of every run and no gate script preserves
 *     it, so the isolation re-run the session did next — the standard next
 *     move — deleted the only copy. That is F56's own recorded lesson
 *     ("copy the trace BEFORE re-running") repeating on a new row.
 *     **Answered here by writing evidence somewhere playwright does not
 *     own** (`EVIDENCE_ROOT`, gitignored) and, above all, to STDOUT: a
 *     composed gate keeps its log (F135), and a log survives every
 *     subsequent run.
 *  2. **The nomination helper had no server read-back.** It clicked
 *     "Nominate at $1" and returned. So *"the commissioner nominated and the
 *     manager missed the broadcast"* and *"no nomination was ever issued"*
 *     were INDISTINGUISHABLE from the failure — two different bugs, in two
 *     different layers, behind one identical red. (Answered in the spec's own
 *     `confirmNominationLanded`.)
 *  3. **The harness sweep destroyed the server-side evidence.**
 *     `test.afterAll` runs `cleanupSweep`, so by the time anyone read server
 *     state the draft was gone (`0 rows`). Capture therefore happens inside
 *     the failing test's own `catch`, ahead of every teardown.
 *
 * **The instruments, and what each one settles.**
 *
 * - `SocketLedger` records, per browser, every realtime frame the PAGE
 *   actually saw. It answers "was the channel deaf?" directly: a room that
 *   received `tick` beats and no `drafts` broadcast is a LOST BROADCAST; a
 *   room that received nothing after its join is a DEAF CHANNEL (F74/D325's
 *   shape); a room that received the `drafts` frame carrying the nomination
 *   and still rendered "waiting" is a CLIENT-SIDE defect (F304's fetch stomp
 *   is the standing candidate). For an unproxied page it rides
 *   `page.on('websocket')` — a passive CDP observer that adds no forwarding
 *   hop (deliberately NOT a second `routeWebSocket` proxy: F56's cell records
 *   that hop as a live competing explanation for this very family, and
 *   instrumenting a suspect by adding more of the suspect is not
 *   measurement). A page already behind `routeWebSocket` has no browser
 *   socket for CDP to see, so its ledger is fed from the passthrough.
 * - `captureDraftFailureEvidence` reads the authoritative server state BEFORE
 *   any sweep, screenshots both browsers, and writes the lot to `EVIDENCE_ROOT`
 *   *and* stdout.
 *
 * Nothing here changes what any spec ASSERTS. It changes only what a failure
 * leaves behind.
 */

// ---------------------------------------------------------------------------
// Realtime frame ledger
// ---------------------------------------------------------------------------

/** Ring-buffer bound. A 16-lot auction beats every ~5s for ~7 minutes plus
 *  its broadcasts and phoenix heartbeats — a few hundred frames — so this
 *  holds a whole run in practice while refusing to grow without limit if a
 *  spec ever drives a burst. Overflow is COUNTED, never silently dropped:
 *  `droppedFrames` is reported beside the buffer. */
const MAX_FRAMES = 800

/** How much of an unparseable frame to keep, so a shape change is visible
 *  rather than invisible. */
const RAW_SNIPPET_CHARS = 200

export interface LedgerFrame {
  /** ms since the ledger was attached. */
  t: number
  dir: 'in' | 'out'
  /** Phoenix topic, e.g. `realtime:draft:<uuid>`. */
  topic: string | null
  /** Phoenix envelope event: `broadcast` / `phx_join` / `phx_reply` / … */
  event: string | null
  /** For a broadcast, the INNER event name: `drafts` / `tick` / `draft_bids` … */
  inner: string | null
  /** A compact, event-specific discriminator (see `describeFrame`). */
  detail: string | null
  /** Present only when the frame could not be parsed as JSON. */
  raw?: string
}

export interface LedgerSnapshot {
  label: string
  socketsOpened: number
  socketsClosed: number
  socketErrors: string[]
  /** Lifetime counts keyed `dir:event` / `dir:broadcast:<inner>`. */
  counts: Record<string, number>
  droppedFrames: number
  frames: LedgerFrame[]
}

export interface SocketLedger {
  snapshot(): LedgerSnapshot
  /** Frames received since `t >= sinceMs`, for a windowed report. */
  since(sinceMs: number): LedgerFrame[]
  /** ms since the ledger was attached — the same clock `LedgerFrame.t` uses. */
  elapsed(): number
  /**
   * Feed one frame in by hand. This is how a page whose socket is already
   * proxied by `page.routeWebSocket` is recorded: Playwright's route shims
   * `window.WebSocket` in the page, so no real browser socket exists for
   * `page.on('websocket')` to observe, and the ONLY place those frames pass
   * through is the spec's own passthrough handler. `in` = server → browser.
   */
  record(dir: 'in' | 'out', payload: string | Buffer): void
  /** Note a socket lifecycle event on a hand-fed ledger. */
  noteSocket(kind: 'open' | 'close' | 'error', detail: string): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** One decoded realtime frame: the phoenix envelope plus, for a broadcast,
 *  the USER payload the app's handlers actually receive. */
interface DecodedFrame {
  topic: string | null
  event: string | null
  inner: string | null
  payload: Record<string, unknown> | null
  /** Set when the frame could not be decoded at all. */
  undecodable?: string
}

/**
 * Decode what supabase-realtime actually puts on the wire — MEASURED, not
 * assumed, and the reason this is not a two-line `JSON.parse`.
 *
 * `@supabase/realtime-js`'s `Serializer` (`lib/serializer.js`) uses TWO wire
 * forms, and the one that matters here is the binary one:
 *
 *  - **Control and non-broadcast frames are a JSON ARRAY**, not an object:
 *    `[join_ref, ref, topic, event, payload]` (`decode`'s string branch). A
 *    naive `parsed.event` reads `undefined` on every one of them.
 *  - **Every user broadcast arrives as a BINARY frame**, kind `4`
 *    (`KINDS.userBroadcast`): `[kind][topicSize][eventSize][metaSize]`
 *    `[payloadEncoding]` then topic, event, metadata and the payload, the
 *    payload JSON-encoded when `payloadEncoding === 1`
 *    (`_decodeUserBroadcast`). In a first instrumented run of this spec
 *    **107 of the manager's frames were binary** — i.e. the entire `drafts`
 *    / `tick` / `draft_bids` traffic this ledger exists to record.
 */
function decodeRealtimeFrame(payload: string | Buffer): DecodedFrame {
  if (typeof payload !== 'string') {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const kind = view.byteLength > 0 ? view.getUint8(0) : -1
    // 4 = userBroadcast (server → client). 3 = userBroadcastPush (client →
    // server) and carries the same header shape.
    if (kind !== 4 && kind !== 3) {
      return { topic: null, event: null, inner: null, payload: null, undecodable: `binary kind ${kind}` }
    }
    try {
      const topicSize = view.getUint8(1)
      const eventSize = view.getUint8(2)
      const metaSize = view.getUint8(3)
      const encoding = view.getUint8(4)
      const decoder = new TextDecoder()
      let offset = 5
      const topic = decoder.decode(payload.subarray(offset, offset + topicSize))
      offset += topicSize
      const inner = decoder.decode(payload.subarray(offset, offset + eventSize))
      offset += eventSize + metaSize
      const body = payload.subarray(offset)
      const parsed: unknown = encoding === 1 ? JSON.parse(decoder.decode(body)) : null
      return {
        topic,
        event: 'broadcast',
        inner,
        payload: isRecord(parsed) ? parsed : null,
      }
    } catch (error) {
      return {
        topic: null,
        event: null,
        inner: null,
        payload: null,
        undecodable: `binary decode failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return {
      topic: null,
      event: null,
      inner: null,
      payload: null,
      undecodable: payload.slice(0, RAW_SNIPPET_CHARS),
    }
  }
  if (Array.isArray(parsed)) {
    const [, , topic, event, body] = parsed as unknown[]
    return {
      topic: asString(topic),
      event: asString(event),
      inner: isRecord(body) ? asString(body.event) : null,
      payload: isRecord(body) ? body : null,
    }
  }
  if (isRecord(parsed)) {
    const body = isRecord(parsed.payload) ? parsed.payload : null
    return {
      topic: asString(parsed.topic),
      event: asString(parsed.event),
      inner: body ? asString(body.event) : null,
      payload: body,
    }
  }
  return { topic: null, event: null, inner: null, payload: null, undecodable: 'non-object JSON' }
}

/**
 * The one-line discriminator for a decoded frame. Deliberately narrow: these
 * are the fields the room's own reducer and its heartbeat-gap detector read
 * (`use-draft-ops.ts` — `reduceDraftsEvent`, `heartbeatSignalsGap`), so a
 * frame's line here can be compared directly against what the page rendered.
 */
function describeFrame(inner: string | null, payload: Record<string, unknown>): string | null {
  // A user broadcast's payload is the jsonb `realtime.send()` was given
  // ({operation, table, schema, record} — 070:234); a `tick` beat is
  // {server_now, current_deadline} (068 ARM 3).
  const body = isRecord(payload.payload) ? payload.payload : payload
  if (inner === 'tick') {
    return `server_now=${asString(body.server_now) ?? '?'} deadline=${asString(body.current_deadline) ?? 'null'}`
  }
  const record = isRecord(body.record) ? body.record : null
  if (!record) return null
  if (inner === 'drafts') {
    const nomination = record.current_nomination
    const nominated = isRecord(nomination) ? (asString(nomination.player_id) ?? '?') : 'null'
    return (
      `op=${asString(body.operation) ?? '?'} status=${asString(record.status) ?? '?'} ` +
      `pick=${String(record.current_pick_number ?? 'null')} ` +
      `deadline=${asString(record.current_deadline) ?? 'null'} nomination=${nominated} ` +
      `updated_at=${asString(record.updated_at) ?? '?'}`
    )
  }
  if (inner === 'draft_picks') {
    return `op=${asString(body.operation) ?? '?'} pick=${String(record.pick_number ?? '?')} player=${asString(record.player_id) ?? '?'}`
  }
  if (inner === 'draft_bids') {
    return `op=${asString(body.operation) ?? '?'} seq=${String(record.nomination_seq ?? '?')} amount=${String(record.amount ?? '?')}`
  }
  return `op=${asString(body.operation) ?? '?'}`
}

/**
 * Watch every WebSocket this page opens and record the realtime traffic.
 *
 * PASSIVE by construction — `page.on('websocket')` observes through CDP and
 * neither forwards nor delays a frame. Call it BEFORE the page navigates, so
 * the room's own first join is on the record.
 */
export function createSocketLedger(label: string): SocketLedger {
  const startedAt = Date.now()
  const frames: LedgerFrame[] = []
  const counts: Record<string, number> = {}
  const socketErrors: string[] = []
  let socketsOpened = 0
  let socketsClosed = 0
  let droppedFrames = 0

  const push = (frame: LedgerFrame): void => {
    if (frames.length >= MAX_FRAMES) {
      frames.shift()
      droppedFrames += 1
    }
    frames.push(frame)
  }

  const bump = (key: string): void => {
    counts[key] = (counts[key] ?? 0) + 1
  }

  const record = (dir: 'in' | 'out', payload: string | Buffer): void => {
    try {
      recordUnguarded(dir, payload)
    } catch {
      // An instrument must never be able to break what it observes: this is
      // called from inside a `routeWebSocket` passthrough, one statement
      // before the frame is forwarded to the browser.
      bump(`${dir}:ledger-error`)
    }
  }

  const recordUnguarded = (dir: 'in' | 'out', payload: string | Buffer): void => {
    const decoded = decodeRealtimeFrame(payload)
    if (decoded.undecodable !== undefined) {
      bump(`${dir}:undecodable`)
      push({
        t: Date.now() - startedAt,
        dir,
        topic: null,
        event: null,
        inner: null,
        detail: null,
        raw: decoded.undecodable,
      })
      return
    }
    bump(decoded.inner ? `${dir}:broadcast:${decoded.inner}` : `${dir}:${decoded.event ?? 'unknown'}`)
    push({
      t: Date.now() - startedAt,
      dir,
      topic: decoded.topic,
      event: decoded.event,
      inner: decoded.inner,
      detail: decoded.payload ? describeFrame(decoded.inner, decoded.payload) : null,
    })
  }

  const noteSocket = (kind: 'open' | 'close' | 'error', detail: string): void => {
    if (kind === 'open') socketsOpened += 1
    if (kind === 'close') socketsClosed += 1
    if (kind === 'error') socketErrors.push(detail)
    push({
      t: Date.now() - startedAt,
      dir: 'in',
      topic: detail,
      event: `socket:${kind}`,
      inner: null,
      detail: null,
    })
  }

  return {
    elapsed: () => Date.now() - startedAt,
    since: (sinceMs) => frames.filter((f) => f.t >= sinceMs),
    record,
    noteSocket,
    snapshot: () => ({
      label,
      socketsOpened,
      socketsClosed,
      socketErrors: [...socketErrors],
      counts: { ...counts },
      droppedFrames,
      frames: [...frames],
    }),
  }
}

/** Only the supabase realtime socket is room state. `next dev`'s HMR socket
 *  shares the page and would otherwise bury the evidence — measured at 22
 *  HMR frames + 26 pings against 110 realtime frames in one run. */
const REALTIME_SOCKET = '/realtime/v1/websocket'

/**
 * Observe a page's browser sockets passively — `page.on('websocket')` rides
 * CDP and neither forwards nor delays a frame. Call it BEFORE the page
 * navigates, so the room's own first join is on the record.
 *
 * **On a page behind `page.routeWebSocket` this sees the UPSTREAM leg, not
 * what the browser received** — measured, and the measurement matters because
 * the opposite looked true at first: with nothing being dropped, a CDP ledger
 * and a ledger fed from inside the passthrough recorded the same 107 frames,
 * and only a probe that DROPPED every frame showed the difference (all 15
 * dropped frames still appeared here). So a proxied page needs BOTH: this one
 * for "what the server sent", and a passthrough-fed ledger for "what the
 * browser got". The pair is also the only thing that can indict or exonerate
 * the Node hop itself, which F56's cell keeps on the record as a live
 * competing explanation for this family.
 */
export function attachSocketLedger(page: Page, label: string): SocketLedger {
  const ledger = createSocketLedger(label)
  page.on('websocket', (ws) => {
    if (!ws.url().includes(REALTIME_SOCKET)) return
    ledger.noteSocket('open', ws.url())
    ws.on('framereceived', (frame) => ledger.record('in', frame.payload))
    ws.on('framesent', (frame) => ledger.record('out', frame.payload))
    ws.on('socketerror', (error) => ledger.noteSocket('error', error))
    ws.on('close', () => ledger.noteSocket('close', ws.url()))
  })
  return ledger
}

// ---------------------------------------------------------------------------
// Server-state capture, ahead of every teardown
// ---------------------------------------------------------------------------

/**
 * Where failure evidence is written so it OUTLIVES the next playwright run.
 * `test-results/` is playwright's, and playwright empties it at the start of
 * every run — which is how F308's own artifacts were destroyed by the
 * isolation re-run that followed the failure. Gitignored.
 */
export const EVIDENCE_ROOT = 'e2e-evidence'

export interface DraftFailureEvidence {
  label: string
  failedAt: string
  message: string
  /** Playwright's own artifacts for this test — REAL, and deleted by the next
   *  `playwright test` invocation. Named so the reader copies it first. */
  playwrightOutputDir: string
  screenshots: string[]
  server:
    | {
        market: Awaited<ReturnType<typeof readAuctionMarket>>
        nominatedPlayerName: string | null
        livePickCount: number
        bids: Awaited<ReturnType<typeof readBidLedger>>
      }
    | { readError: string }
  pages: Array<{ label: string; url: string; commandBar: string | null; bodyText: string | null }>
  sockets: LedgerSnapshot[]
}

/** How much rendered page text to keep per browser. The F308 cell's whole
 *  diagnosis rested on one text snapshot, so the snapshot is kept in full
 *  up to this bound rather than reduced to a locator's worth. */
const MAX_PAGE_TEXT = 4_000

async function safeText(
  page: Page,
  read: (page: Page) => Promise<string>,
): Promise<string | null> {
  try {
    return (await read(page)).replace(/\s+/g, ' ').trim().slice(0, MAX_PAGE_TEXT)
  } catch {
    return null
  }
}

/**
 * Capture everything F308 could not read, and print it where the gate's log
 * will keep it.
 *
 * MUST be called from the failing test's own `finally` (or `catch`) — ahead
 * of `test.afterAll`'s `cleanupSweep`, which deletes the draft and with it
 * every answer. Best-effort throughout: an evidence capture that throws
 * would replace the real failure with its own, which is the opposite of the
 * job.
 */
export async function captureDraftFailureEvidence(input: {
  testInfo: TestInfo
  label: string
  service: Supabase
  draftId: string
  error: unknown
  pages: Array<{ label: string; page: Page }>
  ledgers: SocketLedger[]
  /** Only frames at or after this ledger offset are printed (the whole
   *  buffer is still attached) — keeps the stdout block readable when the
   *  failure is late in a long draft. */
  frameWindowFromMs?: number
}): Promise<void> {
  const { testInfo, label, service, draftId, error, pages, ledgers } = input
  const message = error instanceof Error ? error.message : String(error)

  let server: DraftFailureEvidence['server']
  try {
    const market = await readAuctionMarket(service, draftId)
    const bids = await readBidLedger(service, draftId)
    const { count } = await service
      .from('draft_picks')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draftId)
      .eq('is_undone', false)
    server = {
      market,
      nominatedPlayerName: market.nomination
        ? await readPlayerFullName(service, market.nomination.player_id)
        : null,
      livePickCount: count ?? 0,
      bids,
    }
  } catch (readError) {
    server = { readError: readError instanceof Error ? readError.message : String(readError) }
  }

  const pageStates: DraftFailureEvidence['pages'] = []
  for (const { label: pageLabel, page } of pages) {
    pageStates.push({
      label: pageLabel,
      url: page.url(),
      commandBar: await safeText(page, (p) =>
        p.locator('header[aria-label="Draft command bar"]').first().innerText({ timeout: 2_000 }),
      ),
      bodyText: await safeText(page, (p) => p.locator('body').innerText({ timeout: 5_000 })),
    })
  }

  // Somewhere playwright does not own, so the next run cannot delete it.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(EVIDENCE_ROOT, `${stamp}-${label}`)
  const screenshots: string[] = []
  try {
    await mkdir(dir, { recursive: true })
    for (const { label: pageLabel, page } of pages) {
      const file = join(dir, `${pageLabel}.png`)
      await page.screenshot({ path: file, fullPage: true, timeout: 10_000 })
      screenshots.push(file)
    }
  } catch {
    // Best-effort: an evidence capture that throws replaces the real failure
    // with its own, which is the opposite of the job.
  }

  const evidence: DraftFailureEvidence = {
    label,
    failedAt: new Date().toISOString(),
    message,
    playwrightOutputDir: testInfo.outputDir,
    screenshots,
    server,
    pages: pageStates,
    sockets: ledgers.map((l) => l.snapshot()),
  }

  const windowFrom = input.frameWindowFromMs ?? 0
  const lines: string[] = [
    `[evidence:${label}] FAILURE EVIDENCE (captured before teardown — F308/D334)`,
    `[evidence:${label}] message: ${message}`,
    `[evidence:${label}] durable evidence dir: ${dir}` +
      (screenshots.length > 0 ? ` (${screenshots.join(', ')})` : ' (no screenshot)'),
    `[evidence:${label}] playwright artifacts (trace + error-context) live in ` +
      `${testInfo.outputDir} — COPY THAT DIRECTORY BEFORE RE-RUNNING ANYTHING: ` +
      'playwright empties test-results/ at the start of every run, which is how ' +
      "F308's own trace was lost (the F56 lesson).",
    `[evidence:${label}] server: ${JSON.stringify(evidence.server)}`,
  ]
  for (const state of pageStates) {
    lines.push(`[evidence:${label}] page ${state.label}: url=${state.url}`)
    lines.push(`[evidence:${label}] page ${state.label} command bar: ${state.commandBar ?? '(absent)'}`)
    lines.push(`[evidence:${label}] page ${state.label} body: ${state.bodyText ?? '(absent)'}`)
  }
  for (const snap of evidence.sockets) {
    lines.push(
      `[evidence:${label}] socket ${snap.label}: opened=${snap.socketsOpened} closed=${snap.socketsClosed} ` +
        `dropped=${snap.droppedFrames} errors=${JSON.stringify(snap.socketErrors)} counts=${JSON.stringify(snap.counts)}`,
    )
    for (const frame of snap.frames.filter((f) => f.t >= windowFrom)) {
      lines.push(
        `[evidence:${label}] socket ${snap.label} +${frame.t}ms ${frame.dir} ${frame.event ?? '?'}` +
          `${frame.inner ? `/${frame.inner}` : ''}${frame.detail ? ` ${frame.detail}` : ''}` +
          `${frame.raw ? ` raw=${frame.raw}` : ''}`,
      )
    }
  }
  // eslint-disable-next-line no-console -- the evidence must reach STDOUT: a
  // composed gate keeps its log (F135) and nobody digs three gates deep into
  // `test-results/` for an attachment.
  console.log(lines.join('\n'))

  const json = JSON.stringify(evidence, null, 2)
  try {
    await writeFile(join(dir, 'evidence.json'), json, 'utf8')
  } catch {
    // Best-effort — stdout above already carries the same content.
  }
  try {
    await testInfo.attach(`${label}-failure-evidence.json`, {
      body: json,
      contentType: 'application/json',
    })
  } catch {
    // An attachment failure must never mask the real one.
  }
}
