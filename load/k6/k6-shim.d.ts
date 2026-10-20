/**
 * The slice of k6's JavaScript API the load harness uses (M7 L.F2.1),
 * declared here so `npm run type-check` covers the k6 entry files without a
 * new dependency. Shapes follow k6 v1.x (`k6/websockets` is the stable
 * browser-style WebSocket module). If a run reports a missing export, the
 * installed k6 is older than the harness expects — upgrade k6, do not edit
 * this file to match it.
 */

declare const __ENV: Record<string, string | undefined>
declare function open(path: string): string

declare module 'k6' {
  export function check<T>(value: T, sets: Record<string, (v: T) => boolean>): boolean
  export function fail(message?: string): never
  export function sleep(seconds: number): void
}

declare module 'k6/http' {
  export interface RefinedResponse {
    status: number
    body: string | null
    error: string
    error_code: number
  }
  export interface Params {
    headers?: Record<string, string>
    timeout?: string
  }
  interface Http {
    asyncRequest(method: string, url: string, body?: string | null, params?: Params): Promise<RefinedResponse>
    request(method: string, url: string, body?: string | null, params?: Params): RefinedResponse
  }
  const http: Http
  export default http
}

declare module 'k6/metrics' {
  export class Trend {
    constructor(name: string, isTime?: boolean)
    add(value: number): void
  }
  export class Counter {
    constructor(name: string)
    add(value: number): void
  }
}

declare module 'k6/timers' {
  export function setTimeout(fn: () => void, ms: number): number
}

declare module 'k6/execution' {
  const exec: {
    vu: { idInTest: number }
    scenario: { name: string; iterationInTest: number }
  }
  export default exec
}

declare module 'k6/websockets' {
  export class WebSocket {
    constructor(url: string)
    readonly readyState: number
    onopen: (() => void) | null
    onmessage: ((e: { data: string }) => void) | null
    onclose: ((e: { code: number; reason: string }) => void) | null
    onerror: ((e: { error?: string }) => void) | null
    send(data: string): void
    close(): void
  }
}
