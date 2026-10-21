import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The auth callback only ever redirects within its own origin: `next` goes
 * through safeRedirectPath (src/utils/safe-redirect-path.ts).
 */
const exchangeCodeForSession = vi.fn()
const getUser = vi.fn()
const single = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { exchangeCodeForSession, getUser },
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
  }),
}))

import { GET } from './route'

const ORIGIN = 'https://fieldscout.test'

async function locationFor(next: string): Promise<string | null> {
  const url = `${ORIGIN}/auth/callback?code=abc&next=${encodeURIComponent(next)}`
  const res = await GET(new Request(url))
  return res.headers.get('location')
}

describe('GET /auth/callback — next', () => {
  beforeEach(() => {
    exchangeCodeForSession.mockResolvedValue({ error: null })
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    single.mockResolvedValue({ data: { username: 'chosen_name' } })
  })

  it('follows a same-origin path', async () => {
    expect(await locationFor('/reset-password')).toBe(`${ORIGIN}/reset-password`)
  })

  it.each([
    '//evil.example',
    '/\\evil.example',
    '@evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/\t/evil.example',
  ])('falls back to /app for %j', async (next) => {
    expect(await locationFor(next)).toBe(`${ORIGIN}/app`)
  })

  it('falls back to /app when next is absent', async () => {
    const res = await GET(new Request(`${ORIGIN}/auth/callback?code=abc`))
    expect(res.headers.get('location')).toBe(`${ORIGIN}/app`)
  })
})
