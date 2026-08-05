import { describe, expect, it } from 'vitest'

import { pageAll } from './page-all'

/**
 * Regression tests for the production bug of 2026-08-05: PostgREST caps every
 * response at 1000 rows, so a 1086-player pool came back as 1000 and 86 real
 * players (Ronnie Bell → Zonovan Knight) were unreachable in the app no matter
 * what the user searched for. Raising the client-side limit did nothing —
 * paging is the only way past the cap.
 */

/** Fake PostgREST: serves `rows` under a hard per-response cap. */
function server(rows: number[], cap: number, opts: { count?: boolean } = {}) {
  const requests: Array<[number, number]> = []
  const build = (from: number, to: number) => {
    requests.push([from, to])
    const size = Math.min(to - from + 1, cap)
    return Promise.resolve({
      data: rows.slice(from, from + size),
      error: null,
      ...(opts.count === false ? {} : { count: rows.length }),
    })
  }
  return { build, requests }
}

const pool = (n: number) => Array.from({ length: n }, (_, i) => i)

describe('pageAll', () => {
  it('drains a pool larger than the response cap', async () => {
    const { build, requests } = server(pool(1086), 1000)
    const out = await pageAll<number>(build)

    expect(out).toHaveLength(1086)
    expect(new Set(out).size).toBe(1086) // no duplicates across the boundary
    expect(out[1085]).toBe(1085) // the tail that used to go missing
    expect(requests).toHaveLength(2)
  })

  it('converges when the server caps BELOW the requested page size', async () => {
    // The silent-truncation trap: a short page is not proof of exhaustion.
    // Without the exact count this would stop at 400 and look successful.
    const { build } = server(pool(1086), 400)
    const out = await pageAll<number>(build)

    expect(out).toHaveLength(1086)
    expect(new Set(out).size).toBe(1086)
  })

  it('returns an exactly-cap-sized pool without an extra page of work', async () => {
    const { build, requests } = server(pool(1000), 1000)
    const out = await pageAll<number>(build)

    expect(out).toHaveLength(1000)
    expect(requests).toHaveLength(1)
  })

  it('handles an empty pool', async () => {
    const { build } = server([], 1000)
    await expect(pageAll<number>(build)).resolves.toEqual([])
  })

  it('falls back to short-page termination when no count is provided', async () => {
    // Legacy callers (sync modules) do not request a count.
    const { build } = server(pool(1500), 1000, { count: false })
    const out = await pageAll<number>(build)

    expect(out).toHaveLength(1500)
  })

  it('throws instead of silently returning a partial pool on error', async () => {
    await expect(
      pageAll<number>(() =>
        Promise.resolve({ data: null, error: { message: 'boom' } }),
      ),
    ).rejects.toThrow('boom')
  })

  it('surfaces an error raised on a later page', async () => {
    let call = 0
    await expect(
      pageAll<number>((from, to) => {
        call += 1
        if (call > 1) {
          return Promise.resolve({ data: null, error: { message: 'page 2 died' } })
        }
        return Promise.resolve({
          data: pool(1086).slice(from, to + 1),
          error: null,
          count: 1086,
        })
      }),
    ).rejects.toThrow('page 2 died')
  })
})
