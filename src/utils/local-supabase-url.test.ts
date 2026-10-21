import { describe, expect, it } from 'vitest'

import { isLocalSupabaseUrl } from './local-supabase-url'

describe('isLocalSupabaseUrl', () => {
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321', 'https://localhost'])(
    'accepts the local stack %s',
    (url) => expect(isLocalSupabaseUrl(url)).toBe(true),
  )

  it.each([
    undefined,
    null,
    '',
    'not a url',
    'https://abcdefghijklmnop.supabase.co',
    'http://localhost.example.com:54321',
    'http://127.0.0.1.example.com',
    'http://user@evil.example',
    'http://localhost@evil.example',
    'http://evil.example/?h=localhost',
    'ftp://localhost',
  ])('refuses %j', (url) => expect(isLocalSupabaseUrl(url)).toBe(false))
})
