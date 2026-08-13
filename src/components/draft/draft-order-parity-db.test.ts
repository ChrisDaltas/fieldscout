/**
 * draft-order-parity-db.test.ts — THE D90 PARITY FIXTURE (M2 task L.B3.2).
 *
 * D90: engine authority lives in SQL only; TS gets display math "pinned by
 * a SQL-parity fixture across sizes × reversal × linear". This suite is that
 * fixture: for EVERY `team_count` 8..16 (§7.3.8's legal range) × {snake
 * no-reversal, snake 3RR, linear} it calls migration 066's REAL
 * `draft_team_for_pick` on the local stack (broad EXECUTE — pure math, the
 * 066 grants note) and asserts `teamForPick` (draft-order.ts, the board
 * grid's empty-future-cell labeler) answers IDENTICALLY, pick by pick.
 *
 * Depth: rounds 1–4 for every size × mode (the §8.3 behavior set: forward,
 * reverse, the 3RR round-3 flip, the post-flip resume — the same window
 * pgTAP 020 §C golden-pins), plus FULL 16-round depth at one size per mode
 * (8-team — deep-round drift between the twins cannot hide behind a shallow
 * window). Chain to truth: pgTAP 020 separately pins draft_team_for_pick ≡
 * a DRIVEN draft's actual `draft_picks` rows (96 real picks, §C/§E), so
 * TS ≡ SQL here closes display ≡ board truth end-to-end.
 *
 * Requires the local stack (`npx supabase start` + migrations applied) —
 * D59(5); FAILS loudly when the stack is down, never skips (§4.3).
 * Deterministic: fixed uuid orders, no time, no random.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { teamForPick, type OrderedDraftType } from './draft-order'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const supabase = createClient<Database>(LOCAL_URL, LOCAL_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Fixed team ids, slot n ↦ …00NN (the pgTAP 020 §C uuid shape). */
function orderOfSize(n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `00000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, '0')}`,
  )
}

interface ModeSpec {
  label: string
  draftType: OrderedDraftType
  reversal: boolean
}

const MODES: ModeSpec[] = [
  { label: 'snake no-reversal', draftType: 'snake', reversal: false },
  { label: 'snake 3RR', draftType: 'snake', reversal: true },
  { label: 'linear', draftType: 'linear', reversal: false },
]

const TEAM_COUNTS = [8, 9, 10, 11, 12, 13, 14, 15, 16] as const
const MATRIX_ROUNDS = 4
const DEEP_ROUNDS = 16
const DEEP_SIZE = 8
// Deliberately modest: the full vitest run executes this suite BESIDE the
// other stack-backed suites, and a wide RPC burst here starves the local
// PostgREST pool under them (observed as shifting 500s/timeouts in sibling
// files at 48). ~1.6k pure-math calls at 8-wide still finish in seconds.
const CONCURRENCY = 8

/**
 * SQL truth for one pick — the real 066 helper over PostgREST. Transport
 * errors retry a bounded number of times: under the FULL vitest run the
 * local gateway occasionally answers "invalid response from the upstream
 * server" beside the other stack suites, and reporting that hiccup as a
 * parity failure would be the F53 mistake (a setup failure wearing a
 * product failure's name). VALUE drift never retries — the assertion on
 * the returned team is exact and fails on the first comparison.
 */
async function sqlTeamForPick(
  order: readonly string[],
  mode: ModeSpec,
  pick: number,
): Promise<string | null> {
  let lastMessage = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * attempt))
    const { data, error } = await supabase.rpc('draft_team_for_pick', {
      p_draft_order: [...order],
      p_draft_type: mode.draftType,
      p_snake_reversal: mode.reversal,
      p_pick_number: pick,
    })
    if (!error) return (data as string | null) ?? null
    lastMessage = error.message
  }
  throw new Error(
    `draft_team_for_pick(${mode.label}, pick ${pick}) failed after retries: ${lastMessage}`,
  )
}

interface ParityRow {
  size: number
  mode: string
  pick: number
  sql: string | null
  ts: string | null
}

/** Run thunks with bounded concurrency (one RPC per pick — keep the local
 *  PostgREST happy without serializing ~1.5k calls). */
async function pooled<T>(thunks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results = new Array<T>(thunks.length)
  let next = 0
  async function worker() {
    while (next < thunks.length) {
      const i = next++
      results[i] = await thunks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, thunks.length) }, worker))
  return results
}

async function paritySweep(
  sizes: readonly number[],
  modes: readonly ModeSpec[],
  rounds: number,
): Promise<ParityRow[]> {
  const thunks: Array<() => Promise<ParityRow>> = []
  for (const size of sizes) {
    const order = orderOfSize(size)
    for (const mode of modes) {
      for (let pick = 1; pick <= size * rounds; pick++) {
        thunks.push(async () => ({
          size,
          mode: mode.label,
          pick,
          sql: await sqlTeamForPick(order, mode, pick),
          ts: teamForPick(pick, order, mode.draftType, mode.reversal),
        }))
      }
    }
  }
  return pooled(thunks, CONCURRENCY)
}

describe('D90 parity fixture — teamForPick (TS display) ≡ draft_team_for_pick (SQL truth)', () => {
  it(
    `matrix: every team_count 8..16 × {snake, 3RR, linear}, rounds 1–${MATRIX_ROUNDS}`,
    { timeout: 120_000 },
    async () => {
      const rows = await paritySweep(TEAM_COUNTS, MODES, MATRIX_ROUNDS)
      const drift = rows.filter((r) => r.sql !== r.ts)
      // Name the first divergences instead of a bare count — a parity break
      // must say WHERE display and truth disagree.
      expect(
        drift.slice(0, 10).map((r) => `${r.size}-team ${r.mode} pick ${r.pick}: sql=${r.sql} ts=${r.ts}`),
      ).toEqual([])
      // The sweep really covered the whole matrix (assert the reason for
      // emptiness, never infer it — CLAUDE.md).
      const expectedRows = MODES.length * TEAM_COUNTS.reduce((s, n) => s + n * MATRIX_ROUNDS, 0)
      expect(rows).toHaveLength(expectedRows)
      expect(rows.every((r) => r.sql !== null)).toBe(true)
    },
  )

  it(
    `deep board: ${DEEP_SIZE}-team, all ${DEEP_ROUNDS} rounds, all three modes`,
    { timeout: 120_000 },
    async () => {
      const rows = await paritySweep([DEEP_SIZE], MODES, DEEP_ROUNDS)
      const drift = rows.filter((r) => r.sql !== r.ts)
      expect(
        drift.slice(0, 10).map((r) => `${r.mode} pick ${r.pick}: sql=${r.sql} ts=${r.ts}`),
      ).toEqual([])
      expect(rows).toHaveLength(MODES.length * DEEP_SIZE * DEEP_ROUNDS)
    },
  )

  it('guard parity: pick < 1 and an empty order answer NULL on both sides', async () => {
    const order = orderOfSize(8)
    expect(await sqlTeamForPick(order, MODES[0], 0)).toBeNull()
    expect(teamForPick(0, order, 'snake', false)).toBeNull()
    expect(await sqlTeamForPick([], MODES[0], 1)).toBeNull()
    expect(teamForPick(1, [], 'snake', false)).toBeNull()
  })
})
