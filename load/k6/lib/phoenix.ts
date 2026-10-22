/**
 * A minimal Supabase Realtime (Phoenix v1 JSON) client over the `Transport`
 * seam — the same wire the app's realtime-js speaks (M7 L.F2.1).
 *
 * The app joins PRIVATE channels (`draft:<id>`, `league:<id>`; §9.2) with the
 * member's access token in the join payload — exactly what is sent here —
 * so the load is the app's load: the same topics, the same channel auth
 * (realtime.messages RLS), the same Broadcast-from-DB fan-out.
 *
 * Quota violations (§22.6 (4)) are classified, not guessed: any `system` or
 * `phx_reply`/`phx_error`/close reason whose text names a limit is counted.
 * The text list is `QUOTA_MARKERS` — the Realtime service's own wording for
 * its tenant limits (connections, joins, events per second, channels).
 */
import type { Socket, Transport } from './transport'

export interface PhoenixMessage {
  topic: string
  event: string
  payload: Record<string, unknown>
  ref: string | null
  join_ref?: string | null
}

export function encode(msg: PhoenixMessage): string {
  return JSON.stringify(msg)
}

export function decode(raw: string): PhoenixMessage | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PhoenixMessage>
    if (typeof parsed.topic !== 'string' || typeof parsed.event !== 'string') return null
    return {
      topic: parsed.topic,
      event: parsed.event,
      payload: (parsed.payload ?? {}) as Record<string, unknown>,
      ref: (parsed.ref ?? null) as string | null,
      join_ref: (parsed.join_ref ?? null) as string | null,
    }
  } catch {
    return null
  }
}

/** Realtime's tenant-limit wording (lower-cased substrings). */
export const QUOTA_MARKERS = [
  'too_many',
  'too many',
  'rate limit',
  'ratelimit',
  'limit reached',
  'limitreached',
  'max_events',
  'max_concurrent',
  'max_joins',
  'max_channels',
  'quota',
] as const

export function isQuotaText(text: string): boolean {
  const t = text.toLowerCase()
  return QUOTA_MARKERS.some((m) => t.includes(m))
}

/** A message the server sent that says a tenant limit was hit. */
export function isQuotaViolation(msg: PhoenixMessage): boolean {
  if (msg.event !== 'system' && msg.event !== 'phx_reply' && msg.event !== 'phx_error' && msg.event !== 'phx_close') {
    return false
  }
  if (msg.event === 'phx_reply' && (msg.payload.status as string | undefined) === 'ok') return false
  return isQuotaText(JSON.stringify(msg.payload))
}

export interface BroadcastEvent {
  topic: string
  event: string
  payload: Record<string, unknown>
  receivedAtMs: number
}

export interface JoinOptions {
  /** The subtopic, e.g. `draft:<uuid>` (sent as `realtime:<subtopic>`). */
  subtopic: string
  accessToken: string
  presenceKey?: string
}

const REPLY_TIMEOUT_MS = 10_000

interface PendingReply {
  resolve: (payload: Record<string, unknown>) => void
}

/**
 * One socket, any number of channels. `ready` resolves on open; every join
 * resolves with the server's reply (`status` 'ok' | 'error').
 */
export class RealtimeConnection {
  private socket: Socket | null = null
  private refSeq = 0
  private readonly replies = new Map<string, PendingReply>()
  private readonly broadcastListeners: Array<(e: BroadcastEvent) => void> = []
  private readonly presenceListeners: Array<(topic: string, event: string, payload: Record<string, unknown>) => void> = []
  private heartbeatTimer = false
  private closedByUs = false
  readonly ready: Promise<void>
  /** Resolves when the socket closes (any reason). */
  readonly closed: Promise<{ code: number; reason: string }>
  quotaViolations = 0
  unexpectedClose: { code: number; reason: string } | null = null

  constructor(
    private readonly t: Transport,
    url: string,
  ) {
    let openResolve!: () => void
    let openReject!: (e: Error) => void
    let closeResolve!: (v: { code: number; reason: string }) => void
    this.ready = new Promise<void>((res, rej) => {
      openResolve = res
      openReject = rej
    })
    this.closed = new Promise((res) => {
      closeResolve = res
    })
    let opened = false
    // Bounded: a socket that neither opens nor errors must not hang a VU.
    void t.sleep(REPLY_TIMEOUT_MS).then(() => {
      if (!opened) openReject(new Error(`realtime socket did not open within ${REPLY_TIMEOUT_MS / 1000} s`))
    })
    this.socket = t.connect(url, {
      onOpen: () => {
        opened = true
        openResolve()
        this.startHeartbeat()
      },
      onMessage: (data) => this.onMessage(data),
      onClose: (code, reason) => {
        this.heartbeatTimer = false
        if (isQuotaText(reason)) this.quotaViolations += 1
        if (!this.closedByUs) this.unexpectedClose = { code, reason }
        for (const pending of this.replies.values()) pending.resolve({ status: 'error', response: { reason: 'socket closed' } })
        this.replies.clear()
        if (!opened) openReject(new Error(`realtime socket closed before open (${code} ${reason})`))
        closeResolve({ code, reason })
      },
      onError: (message) => {
        if (isQuotaText(message)) this.quotaViolations += 1
        if (!opened) openReject(new Error(`realtime socket error before open: ${message}`))
      },
    })
  }

  onBroadcast(cb: (e: BroadcastEvent) => void): void {
    this.broadcastListeners.push(cb)
  }

  onPresence(cb: (topic: string, event: string, payload: Record<string, unknown>) => void): void {
    this.presenceListeners.push(cb)
  }

  private nextRef(): string {
    this.refSeq += 1
    return String(this.refSeq)
  }

  /** Send and await the server's reply — bounded: a reply that never comes
   *  resolves `{status: 'timeout'}` (counted by the caller as a refusal),
   *  never a hung VU. */
  private push(msg: PhoenixMessage): Promise<Record<string, unknown>> {
    const ref = msg.ref ?? this.nextRef()
    const sent: PhoenixMessage = { ...msg, ref }
    const reply = new Promise<Record<string, unknown>>((resolve) => this.replies.set(ref, { resolve }))
    this.socket?.send(encode(sent))
    const timeout = this.t.sleep(REPLY_TIMEOUT_MS).then(() => {
      this.replies.delete(ref)
      return { status: 'timeout' } as Record<string, unknown>
    })
    return Promise.race([reply, timeout])
  }

  /** Close and wait (bounded) for the socket to report closed. */
  async closeAndWait(): Promise<void> {
    this.close()
    await Promise.race([this.closed, this.t.sleep(REPLY_TIMEOUT_MS)])
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = true
    const beat = async (): Promise<void> => {
      while (this.heartbeatTimer) {
        await this.t.sleep(25_000)
        if (!this.heartbeatTimer) return
        this.socket?.send(encode({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: this.nextRef() }))
      }
    }
    void beat()
  }

  private onMessage(raw: string): void {
    const msg = decode(raw)
    if (msg === null) return
    if (isQuotaViolation(msg)) this.quotaViolations += 1
    if (msg.event === 'phx_reply' && msg.ref !== null) {
      const pending = this.replies.get(msg.ref)
      if (pending) {
        this.replies.delete(msg.ref)
        pending.resolve(msg.payload)
      }
      return
    }
    if (msg.event === 'broadcast') {
      const inner = msg.payload as { event?: unknown; payload?: unknown }
      const e: BroadcastEvent = {
        topic: msg.topic,
        event: typeof inner.event === 'string' ? inner.event : '',
        payload: (inner.payload ?? {}) as Record<string, unknown>,
        receivedAtMs: this.t.nowMs(),
      }
      for (const cb of this.broadcastListeners) cb(e)
      return
    }
    if (msg.event === 'presence_state' || msg.event === 'presence_diff') {
      for (const cb of this.presenceListeners) cb(msg.topic, msg.event, msg.payload)
    }
  }

  /** Join a private channel; resolves with the reply payload and the latency. */
  async join(opts: JoinOptions): Promise<{ ok: boolean; reply: Record<string, unknown>; ms: number }> {
    const ref = this.nextRef()
    const started = this.t.nowMs()
    const reply = await this.push({
      topic: `realtime:${opts.subtopic}`,
      event: 'phx_join',
      payload: {
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: opts.presenceKey ?? '', enabled: opts.presenceKey !== undefined },
          postgres_changes: [],
          private: true,
        },
        access_token: opts.accessToken,
      },
      ref,
      join_ref: ref,
    })
    return { ok: reply.status === 'ok', reply, ms: this.t.nowMs() - started }
  }

  /** Presence `track` on a joined channel (what the app's rooms do). */
  async track(subtopic: string, meta: Record<string, unknown>): Promise<boolean> {
    const reply = await this.push({
      topic: `realtime:${subtopic}`,
      event: 'presence',
      payload: { type: 'presence', event: 'track', payload: meta },
      ref: null,
    })
    return reply.status === 'ok'
  }

  /** Leave a channel. Fire-and-forget: Realtime acknowledges a leave with a
   *  channel close rather than a `phx_reply` (measured locally — awaiting a
   *  reply waits out the timeout every time), and realtime-js does not wait
   *  either before tearing the socket down. */
  leave(subtopic: string): void {
    this.socket?.send(encode({ topic: `realtime:${subtopic}`, event: 'phx_leave', payload: {}, ref: this.nextRef() }))
  }

  close(): void {
    this.closedByUs = true
    this.heartbeatTimer = false
    this.socket?.close()
  }
}

/** Presence keys present in a `presence_state` payload. */
export function presenceKeys(payload: Record<string, unknown>): string[] {
  return Object.keys(payload)
}
