/**
 * POST /api/lists/generate — daily rate-limit behaviour.
 *
 * Pinned here:
 *   1. Under the limit: generation succeeds and spends exactly one slot.
 *   2. At the limit: the last allowed call still succeeds (off-by-one guard).
 *   3. Over the limit: 429 with UTC-honest copy, and NO Claude call is made —
 *      the whole point is that the Anthropic bill stops.
 *   4. Quota counts BILLED attempts: a dispatched call that fails still spends
 *      a slot (it cost real money), and only a request that never reached
 *      Anthropic is refunded. Refunding billed failures would make the UI's
 *      Retry button an unmetered spend loop.
 *   5. Concurrency: N simultaneous submits at the limit take exactly the
 *      remaining slots, never more (the claim is atomic in Postgres; the fake
 *      below reproduces the same check-and-increment-in-one-step semantics).
 *   6. No Pro gate: a free (is_pro = false) account generates normally.
 *
 * The Supabase admin client is faked with an in-memory counter that mirrors
 * migration 074's claim_ai_generation / release_ai_generation contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const usage = new Map<string, number>()
  const key = (user: string, feature: string, day: string) => `${user}|${feature}|${day}`
  const today = () => new Date().toISOString().slice(0, 10)

  /** Mirrors claim_ai_generation: the check and the increment are one step. */
  const claim = (user: string, feature: string, limit: number) => {
    const k = key(user, feature, today())
    const used = usage.get(k) ?? 0
    if (limit < 1 || used >= limit) {
      return { is_allowed: false, used_today: used, daily_limit: limit }
    }
    usage.set(k, used + 1)
    return { is_allowed: true, used_today: used + 1, daily_limit: limit }
  }

  /** Mirrors release_ai_generation: decrement, floored at 0, no-op if absent. */
  const release = (user: string, feature: string) => {
    const k = key(user, feature, today())
    if (!usage.has(k)) return 0
    const next = Math.max((usage.get(k) ?? 0) - 1, 0)
    usage.set(k, next)
    return next
  }

  const structuredClaudeCall = vi.fn()
  const logAiCall = vi.fn(async () => {})
  const resolveGeneratedPlayers = vi.fn(() => ({
    players: [
      {
        rank: 1,
        player_id: 'p1',
        player_name: 'Test Receiver',
        team: 'KC',
        rationale: 'Volume.',
      },
    ],
    unresolved: [] as string[],
  }))

  return {
    usage,
    key,
    today,
    claim,
    release,
    structuredClaudeCall,
    logAiCall,
    resolveGeneratedPlayers,
  }
})

const USER_ID = '11111111-1111-4111-8111-111111111111'
const FEATURE = 'list_generation'

// --- Module fakes -----------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
  }),
}))

vi.mock('@/lib/supabase/admin', () => {
  /** Minimal chainable stand-in for the `ai_generation_usage` read. */
  const from = () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({
        data: { used: h.usage.get(h.key(USER_ID, FEATURE, h.today())) ?? 0 },
        error: null,
      }),
    }
    return builder
  }

  return {
    createAdminClient: () => ({
      from,
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'claim_ai_generation') {
          return {
            data: [
              h.claim(
                args.p_user_id as string,
                args.p_feature as string,
                args.p_limit as number,
              ),
            ],
            error: null,
          }
        }
        if (name === 'release_ai_generation') {
          return {
            data: h.release(args.p_user_id as string, args.p_feature as string),
            error: null,
          }
        }
        throw new Error(`unexpected rpc: ${name}`)
      },
    }),
  }
})

vi.mock('@/lib/claude/client', () => ({ isClaudeConfigured: () => true }))
// Partial mock: the real isUnbilledClaudeError must run, since it is what
// decides whether a failure refunds the slot.
vi.mock('@/lib/claude/structured', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/claude/structured')>()),
  structuredClaudeCall: h.structuredClaudeCall,
}))
vi.mock('@/lib/claude/telemetry', () => ({ logAiCall: h.logAiCall }))
vi.mock('@/lib/claude/persona-gen', () => ({ buildGenerationPrompt: () => 'PROMPT' }))
vi.mock('@/lib/claude/player-packet', () => ({
  buildPlayerPacket: async () => ({
    rendered: 'PACKET',
    players: [{ id: 'p1', name: 'Test Receiver', team: 'KC' }],
  }),
  resolveGeneratedPlayers: h.resolveGeneratedPlayers,
}))

// Imported after the mocks are registered.
const { POST } = await import('./route')

// --- Helpers ----------------------------------------------------------------

const body = {
  position: 'WR' as const,
  scoring: 'PPR' as const,
  player_count: 10 as const,
}

const post = () =>
  POST(
    new Request('http://localhost/api/lists/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

const usedToday = () => h.usage.get(h.key(USER_ID, FEATURE, h.today())) ?? 0

const succeeds = () =>
  h.structuredClaudeCall.mockResolvedValue({
    data: {
      players: [{ rank: 1, player_name: 'Test Receiver', team: 'KC', rationale: 'Volume.' }],
      style_note: 'Target-share first.',
    },
    inputTokens: 100,
    outputTokens: 200,
    latencyMs: 900,
  })

beforeEach(() => {
  h.usage.clear()
  h.structuredClaudeCall.mockReset()
  h.logAiCall.mockClear()
  // mockClear (not mockReset) — the default implementation must survive.
  h.resolveGeneratedPlayers.mockClear()
  process.env.AI_LIST_GENERATION_DAILY_LIMIT = '3'
})

afterEach(() => {
  delete process.env.AI_LIST_GENERATION_DAILY_LIMIT
})

// --- Tests ------------------------------------------------------------------

describe('under the limit', () => {
  it('generates and spends exactly one of the three daily slots', async () => {
    succeeds()
    const res = await post()

    expect(res.status).toBe(200)
    expect(usedToday()).toBe(1)
    expect(h.structuredClaudeCall).toHaveBeenCalledTimes(1)
  })

  it('does not consult is_pro — the Pro gate is gone (free-only launch)', async () => {
    // The fake server client exposes ONLY auth.getUser(); any profiles read
    // (the old requireProUser path) would throw here.
    succeeds()
    expect((await post()).status).toBe(200)
  })
})

describe('at the limit', () => {
  it('allows the 3rd call and blocks the 4th', async () => {
    succeeds()

    for (let i = 1; i <= 3; i++) {
      const res = await post()
      expect(res.status).toBe(200)
      expect(usedToday()).toBe(i)
    }

    expect((await post()).status).toBe(429)
    expect(usedToday()).toBe(3) // a refused call does not inflate the counter
  })
})

describe('over the limit', () => {
  beforeEach(() => {
    h.usage.set(h.key(USER_ID, FEATURE, h.today()), 3)
  })

  it('returns 429 without calling Claude — the bill stops here', async () => {
    succeeds()
    const res = await post()

    expect(res.status).toBe(429)
    expect(h.structuredClaudeCall).not.toHaveBeenCalled()
  })

  it('returns a specific, UTC-honest, non-upsell message with the reset time', async () => {
    const payload = (await (await post()).json()) as {
      error: string
      code: string
      limit: number
      remaining: number
      resets_at: string
    }

    expect(payload.code).toBe('RATE_LIMITED')
    expect(payload.limit).toBe(3)
    expect(payload.remaining).toBe(0)
    expect(payload.error).toContain('midnight UTC')
    expect(payload.error).not.toMatch(/\btomorrow\b/i)
    expect(payload.error).not.toMatch(/\bPro\b|upgrade/i)

    // resets_at is the next UTC midnight, and it is in the future.
    expect(payload.resets_at).toMatch(/T00:00:00\.000Z$/)
    expect(Date.parse(payload.resets_at)).toBeGreaterThan(Date.now())
  })

  it('respects a raised env limit without a code change', async () => {
    process.env.AI_LIST_GENERATION_DAILY_LIMIT = '5'
    succeeds()

    expect((await post()).status).toBe(200)
    expect(usedToday()).toBe(4)
  })

  it('a limit of 0 switches generation off for everyone', async () => {
    h.usage.clear()
    process.env.AI_LIST_GENERATION_DAILY_LIMIT = '0'
    succeeds()

    expect((await post()).status).toBe(429)
    expect(h.structuredClaudeCall).not.toHaveBeenCalled()
    expect(usedToday()).toBe(0)
  })
})

describe('quota counts BILLED attempts, not successes', () => {
  // The cap exists to bound the Anthropic bill. A response that arrives
  // truncated or unparseable costs exactly what a good one costs, so it must
  // consume a slot — otherwise the UI's Retry button is an unmetered spend
  // loop: click forever, pay every time, counter never moves.
  it('consumes the slot when a dispatched call fails', async () => {
    h.structuredClaudeCall.mockRejectedValue(new Error('anthropic 529 overloaded'))

    const res = await post()

    expect(res.status).toBe(500)
    expect(usedToday()).toBe(1) // billed → spent
  })

  it('bounds repeated failures at the limit instead of allowing infinite retries', async () => {
    h.structuredClaudeCall.mockRejectedValue(new Error('truncated output'))
    for (let i = 0; i < 5; i++) await post()

    // Exactly `limit` calls reached Anthropic; the rest were refused at 429.
    expect(usedToday()).toBe(3)
    expect(h.structuredClaudeCall).toHaveBeenCalledTimes(3)
    expect((await post()).status).toBe(429)
  })

  it('consumes the slot when generation resolves to no usable players', async () => {
    succeeds()
    h.resolveGeneratedPlayers.mockReturnValueOnce({
      players: [],
      unresolved: ['Nobody At All'],
    })

    const res = await post()

    expect(res.status).toBe(500)
    expect(usedToday()).toBe(1) // the response was billed
  })

  it('REFUNDS when the request never reached Anthropic', async () => {
    // APIConnectionError = no response received = nothing billed. This is the
    // only failure class that may safely give the slot back.
    const { APIConnectionError } = await import('@anthropic-ai/sdk')
    h.structuredClaudeCall.mockRejectedValue(
      new APIConnectionError({ message: 'socket hang up' }),
    )

    const res = await post()

    expect(res.status).toBe(500)
    expect(usedToday()).toBe(0)
  })

  it('a malformed request 400s without touching the counter', async () => {
    succeeds()
    const res = await POST(
      new Request('http://localhost/api/lists/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ position: 'NOT_A_POSITION' }),
      }),
    )

    expect(res.status).toBe(400)
    expect(usedToday()).toBe(0)
    expect(h.structuredClaudeCall).not.toHaveBeenCalled()
  })
})

describe('concurrency', () => {
  it('two rapid double-submits at the last slot yield one 200 and one 429', async () => {
    h.usage.set(h.key(USER_ID, FEATURE, h.today()), 2) // one slot left
    succeeds()

    const results = await Promise.all([post(), post()])
    const statuses = results.map((r) => r.status).sort()

    expect(statuses).toEqual([200, 429])
    expect(usedToday()).toBe(3)
    expect(h.structuredClaudeCall).toHaveBeenCalledTimes(1)
  })

  it('six simultaneous submits spend exactly the three-per-day allowance', async () => {
    succeeds()

    const results = await Promise.all(Array.from({ length: 6 }, () => post()))

    expect(results.filter((r) => r.status === 200)).toHaveLength(3)
    expect(results.filter((r) => r.status === 429)).toHaveLength(3)
    expect(usedToday()).toBe(3)
    expect(h.structuredClaudeCall).toHaveBeenCalledTimes(3)
  })
})
