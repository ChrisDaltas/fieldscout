/**
 * PUT /api/scoring-systems — custom scoring is open to every signed-in
 * account while the Pro rules are on hold (Chris, 2026-10-16: "yes open up
 * custom scoring too"). It was Pro-only (business rule 6); the check stays
 * behind CUSTOM_SCORING_PRO_ONLY (src/lib/scoring/custom-scoring-access.ts).
 *
 * The fake server client exposes ONLY auth.getUser(): any profiles read —
 * the requireProUser path — would throw, so a 200 here proves no is_pro
 * check ran.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  user: { id: 'free-user' } as { id: string } | null,
  save: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}))

vi.mock('@/lib/scoring/personal-scoring-system', () => ({
  savePersonalScoringSystem: h.save,
}))

import { canCustomizeScoring, CUSTOM_SCORING_PRO_ONLY } from '@/lib/scoring/custom-scoring-access'

import { PUT } from './route'

const put = (body: unknown) =>
  PUT(new Request('http://localhost/api/scoring-systems', { method: 'PUT', body: JSON.stringify(body) }))

const RULES = { receptions: 0.5, passing_tds: 4 }

beforeEach(() => {
  h.user = { id: 'free-user' }
  h.save.mockReset()
  h.save.mockResolvedValue({ ok: true, status: 200, row: { id: 'sys-1', name: 'My league', rules: RULES } })
})

describe('custom scoring is open to everyone while Pro is on hold', () => {
  it('the switch is off, so a free account can customize', () => {
    expect(CUSTOM_SCORING_PRO_ONLY).toBe(false)
    expect(canCustomizeScoring(false)).toBe(true)
    expect(canCustomizeScoring(true)).toBe(true)
  })

  it('a free account saves its custom system — no is_pro read', async () => {
    const res = await put({ name: 'My league', rules: RULES })
    expect(res.status).toBe(200)
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save.mock.calls[0]![1]).toBe('free-user')
  })

  it('still requires a signed-in user', async () => {
    h.user = null
    const res = await put({ name: 'My league', rules: RULES })
    expect(res.status).toBe(401)
    expect(h.save).not.toHaveBeenCalled()
  })

  it('still validates the body', async () => {
    const res = await put({ name: '', rules: { receptions: 'lots' } })
    expect(res.status).toBe(400)
    expect(h.save).not.toHaveBeenCalled()
  })

  it('the settings page reads the same switch for every control', () => {
    const page = readFileSync(
      path.resolve(process.cwd(), 'src/app/app/(shell)/settings/scoring/page.tsx'),
      'utf8',
    )
    expect(page).toContain('canCustomizeScoring(isPro)')
    // No control is gated on is_pro directly any more.
    expect(page).not.toMatch(/disabled=\{!isPro/)
    expect(page).not.toMatch(/\{isPro && \(/)
    expect(page).not.toMatch(/\{!isPro && \(/)
  })
})
