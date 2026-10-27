/**
 * DELETE /api/leagues/[id] is retired (212 / F716 — Chris 2026-10-27:
 * leagues are archived, never deleted). It answers 405 in plain words for
 * every caller and never reaches the database; the commissioner archives.
 */
import { describe, expect, it, vi } from 'vitest'

const createServerClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => createServerClient() }))

describe('DELETE /api/leagues/[id]', () => {
  it('answers 405 with the archive words, without touching the database', async () => {
    const { DELETE } = await import('./route')
    const res = await DELETE()
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('GET, PATCH')
    expect(await res.json()).toEqual({
      error: 'Leagues aren’t deleted — the commissioner can archive the league from League settings, and restore it any time.',
    })
    expect(createServerClient).not.toHaveBeenCalled()
  })
})
