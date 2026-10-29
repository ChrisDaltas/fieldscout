/**
 * faults — the in-process fault injectors of M7 L.F2.3's chaos drills
 * (tasks-M7 §6 L.F2.3; delivery plan :98 "kill realtime mid-draft;
 * delay/duplicate provider rows; crash a worker mid-batch"; spec §22.6 /
 * §23.2 / §24.3; PROGRESS D760–D765; the PR #540 fix round D766).
 *
 * WHY IN-PROCESS. The local Supabase stack is shared by every builder (the
 * one-local-DB rule), so a drill never stops a container. Every fault is
 * injected at a seam the app already has:
 *
 *   - REALTIME — the `transport` option realtime-js takes (a WebSocket
 *     constructor). `realtimeKillSwitch()` hands out a WebSocket class whose
 *     sockets the drill can drop at once and whose new sockets go to a port
 *     nothing listens on, so realtime-js sees exactly what a dead Realtime
 *     service looks like from a browser — the socket closes, every channel
 *     reports CHANNEL_ERROR / TIMED_OUT / CLOSED, reconnects keep failing —
 *     until `restore()`.
 *   - STATS — the `StatsProvider` interface (§23.1). `FaultyProvider` wraps
 *     a provider and can duplicate rows, withhold (delay) rows, serve a stale
 *     line, or fail whole polls.
 *   - WORKERS — the Supabase client the worker / ingest is handed.
 *     `crashingClient()` wraps it so a named RPC "crashes" on a chosen call:
 *     `before` = the process dies before the request leaves (nothing reached
 *     the database); `after` = the request is sent and committed, then the
 *     process dies before it reads the answer (the database moved; the
 *     worker never knew).
 *
 * Pure of clock and entropy (the D3 guard covers this file).
 */
import type { StatTier } from '@/lib/leagues/stats/stat-keys'
import type {
  ProviderGame,
  ProviderGameState,
  ProviderInactives,
  ProviderInjury,
  ProviderPlayerWeekStats,
  StatsProvider,
} from '@/lib/leagues/stats/stats-provider'

// ── Realtime ────────────────────────────────────────────────────────────────

/** A port nothing listens on — a new socket there is refused at once. */
export const DEAD_REALTIME_URL = 'ws://127.0.0.1:9/realtime/v1/websocket'

export interface RealtimeKillSwitch {
  /** Hand this to `createClient(url, key, { realtime: { transport } })`. */
  transport: typeof WebSocket
  /** Drop every open socket and refuse every new one until `restore()`. */
  kill: () => void
  /** Let new sockets reach the real Realtime service again. */
  restore: () => void
  readonly dead: boolean
  /** Sockets opened to the real service. */
  readonly opened: number
  /** Sockets sent to the dead port while killed. */
  readonly refused: number
  /** Sockets this switch closed when it was killed. */
  readonly dropped: number
}

export function realtimeKillSwitch(): RealtimeKillSwitch {
  const Base = globalThis.WebSocket
  if (typeof Base !== 'function') throw new Error('realtimeKillSwitch: this runtime has no global WebSocket (Node 22+ is required)')
  const state = { dead: false, opened: 0, refused: 0, dropped: 0 }
  const live = new Set<WebSocket>()

  class ChaosWebSocket extends Base {
    constructor(url: string | URL, protocols?: string | string[]) {
      const refused = state.dead
      super(refused ? DEAD_REALTIME_URL : url, protocols)
      if (refused) {
        state.refused += 1
        return
      }
      state.opened += 1
      live.add(this)
      this.addEventListener('close', () => live.delete(this))
    }
  }

  return {
    transport: ChaosWebSocket,
    kill() {
      state.dead = true
      for (const socket of [...live]) {
        live.delete(socket)
        state.dropped += 1
        // 4000–4999 is the application range; realtime-js did not ask for
        // this close, so it reads it as unclean and starts reconnecting.
        socket.close(4000, 'chaos: realtime killed')
      }
    },
    restore() {
      state.dead = false
    },
    get dead() {
      return state.dead
    },
    get opened() {
      return state.opened
    },
    get refused() {
      return state.refused
    },
    get dropped() {
      return state.dropped
    },
  }
}

// ── Stats provider ──────────────────────────────────────────────────────────

/** What a FaultyProvider does to the next `getWeekStats` answers. */
export interface ProviderFaults {
  /** Player id → how many copies of his row the response carries (≥ 2 duplicates it). */
  duplicate?: ReadonlyMap<string, number>
  /** Player id → a SECOND row for him with these stats (same player, different numbers). */
  conflicting?: ReadonlyMap<string, Partial<Record<string, number>>>
  /** Players whose rows are held back (a late provider row). */
  withhold?: ReadonlySet<string>
  /** Player id → the row served INSTEAD of the current one (a stale cached line). */
  stale?: ReadonlyMap<string, ProviderPlayerWeekStats>
  /** Fail this many whole polls (getSchedule throws) before answering again. */
  failPolls?: number
}

/**
 * Apply the row faults to one `getWeekStats` answer. Pure — the unit tests
 * pin it; the provider below is a thin shell around it.
 */
export function applyRowFaults(lines: readonly ProviderPlayerWeekStats[], faults: ProviderFaults): ProviderPlayerWeekStats[] {
  const out: ProviderPlayerWeekStats[] = []
  for (const line of lines) {
    if (faults.withhold?.has(line.playerId)) continue
    const served = faults.stale?.get(line.playerId) ?? line
    const copies = Math.max(1, faults.duplicate?.get(line.playerId) ?? 1)
    for (let i = 0; i < copies; i++) out.push({ ...served, stats: { ...served.stats }, advanced: { ...served.advanced } })
    const other = faults.conflicting?.get(line.playerId)
    if (other !== undefined) out.push({ ...served, stats: { ...served.stats, ...other }, advanced: { ...served.advanced } })
  }
  return out
}

export class ProviderPollFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderPollFailure'
  }
}

/** A StatsProvider whose answers the drill bends (see `ProviderFaults`). */
export class FaultyProvider implements StatsProvider {
  readonly name: string
  readonly capabilities: ReadonlySet<StatTier>
  faults: ProviderFaults = {}
  /** Polls failed so far (each `getSchedule` that threw). */
  failed = 0

  constructor(private readonly base: StatsProvider) {
    this.name = base.name
    this.capabilities = base.capabilities
  }

  async getSchedule(season: number): Promise<ProviderGame[]> {
    if ((this.faults.failPolls ?? 0) > 0) {
      this.faults = { ...this.faults, failPolls: (this.faults.failPolls ?? 0) - 1 }
      this.failed += 1
      throw new ProviderPollFailure(`chaos: provider outage (poll ${this.failed} refused)`)
    }
    return this.base.getSchedule(season)
  }

  getGameStates(season: number, week: number): Promise<ProviderGameState[]> {
    return this.base.getGameStates(season, week)
  }

  async getWeekStats(season: number, week: number): Promise<ProviderPlayerWeekStats[]> {
    return applyRowFaults(await this.base.getWeekStats(season, week), this.faults)
  }

  getInjuries(season: number, week: number): Promise<ProviderInjury[]> {
    return this.base.getInjuries(season, week)
  }

  getInactives(season: number, week: number): Promise<ProviderInactives[]> {
    return this.base.getInactives(season, week)
  }
}

/**
 * A StatsProvider over a script the drill moves phase by phase: the
 * schedule and the lines are whatever `games` / `lines` hold when polled.
 */
export class ScriptedProvider implements StatsProvider {
  readonly capabilities: ReadonlySet<StatTier> = new Set<StatTier>(['core_box'])
  games: ProviderGame[] = []
  lines: ProviderPlayerWeekStats[] = []

  constructor(readonly name: string) {}

  async getSchedule(season: number): Promise<ProviderGame[]> {
    return this.games.filter((g) => g.season === season).map((g) => ({ ...g }))
  }

  async getGameStates(): Promise<ProviderGameState[]> {
    return []
  }

  async getWeekStats(season: number, week: number): Promise<ProviderPlayerWeekStats[]> {
    return this.lines.filter((l) => l.season === season && l.week === week).map((l) => ({ ...l, stats: { ...l.stats }, advanced: { ...l.advanced } }))
  }

  async getInjuries(): Promise<ProviderInjury[]> {
    return []
  }

  async getInactives(): Promise<ProviderInactives[]> {
    return []
  }
}

// ── Worker crashes ──────────────────────────────────────────────────────────

/** `before`: dies before the request leaves. `after`: the request commits, then it dies. */
export type CrashMode = 'before' | 'after'

export interface CrashPlan {
  /** The RPC that crashes. */
  rpc: string
  mode: CrashMode
  /** Which calls of that RPC crash, 1-based (e.g. `(n) => n === 2`, or `() => true` for every call). */
  on: (callNumber: number) => boolean
}

export class WorkerCrash extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkerCrash'
  }
}

export interface CrashLog {
  /** Calls seen per RPC name (crashed or not). */
  calls: Map<string, number>
  /** One line per crash: `<rpc> #<n> <mode>`. */
  crashes: string[]
}

type RpcCapable = { rpc: (fn: string, args?: unknown, options?: unknown) => PromiseLike<unknown> }

/**
 * Wrap a Supabase client so the planned RPC calls crash. Every other member
 * (`from`, `auth`, …) is the real client's, bound to it.
 */
export function crashingClient<C extends object>(client: C, plans: readonly CrashPlan[]): { client: C; log: CrashLog } {
  const log: CrashLog = { calls: new Map(), crashes: [] }
  const wrapped = new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'rpc') {
        const real = target as unknown as RpcCapable
        return (fn: string, args?: unknown, options?: unknown) => {
          const n = (log.calls.get(fn) ?? 0) + 1
          log.calls.set(fn, n)
          const plan = plans.find((p) => p.rpc === fn && p.on(n))
          if (plan === undefined) return real.rpc(fn, args, options)
          log.crashes.push(`${fn} #${n} ${plan.mode}`)
          const crash = new WorkerCrash(`chaos: worker crashed ${plan.mode === 'before' ? 'before sending' : 'after sending'} ${fn} (call ${n})`)
          if (plan.mode === 'before') return Promise.reject(crash)
          return Promise.resolve(real.rpc(fn, args, options)).then(() => {
            throw crash
          })
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { client: wrapped, log }
}
