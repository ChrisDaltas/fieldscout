/**
 * requireAdminUser / isAdminViewer (M8 L.G1.6; spec §24.4 "Where"; Q96;
 * TD8; F581): anyone who is not an admin — signed out or signed in — gets
 * 404, never 401 / 403; a failed profile read is a loud 500 / throw, never
 * "not an admin".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const single = vi.fn()
const client = {
  auth: { getUser },
  from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => client }))

import { isAdminViewer, requireAdminUser } from './require-admin'

beforeEach(() => {
  getUser.mockReset()
  single.mockReset()
})

describe('requireAdminUser', () => {
  it('signed out → 404 Not found (not 401)', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const r = await requireAdminUser()
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(404)
      expect(await r.response.json()).toEqual({ error: 'Not found' })
    }
  })

  it('signed in, not an admin → 404 Not found (not 403)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u' } } })
    single.mockResolvedValue({ data: { is_admin: false }, error: null })
    const r = await requireAdminUser()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(404)
  })

  it('a failed profile read is a loud 500, not a quiet 404', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u' } } })
    single.mockResolvedValue({ data: null, error: { message: 'db down' } })
    const r = await requireAdminUser()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(500)
  })

  it('an admin passes with the own session client', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'op' } } })
    single.mockResolvedValue({ data: { is_admin: true }, error: null })
    const r = await requireAdminUser()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.supabase).toBe(client)
  })
})

describe('isAdminViewer (the /app/admin layout)', () => {
  it('false signed out and for a non-admin, true for an admin', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect(await isAdminViewer()).toBe(false)
    getUser.mockResolvedValue({ data: { user: { id: 'u' } } })
    single.mockResolvedValue({ data: { is_admin: false }, error: null })
    expect(await isAdminViewer()).toBe(false)
    single.mockResolvedValue({ data: { is_admin: true }, error: null })
    expect(await isAdminViewer()).toBe(true)
  })

  it('throws on a failed profile read', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u' } } })
    single.mockResolvedValue({ data: null, error: { message: 'db down' } })
    await expect(isAdminViewer()).rejects.toThrow(/could not read the profile/)
  })
})
