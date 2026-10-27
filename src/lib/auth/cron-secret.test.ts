/**
 * isCronAuthorized (M7 L.F2.8, F721) — and the census that every cron route
 * uses it instead of its own `!==` compare.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { isCronAuthorized } from './cron-secret'

const req = (auth?: string) =>
  new Request('http://localhost/api/cron/x', auth === undefined ? {} : { headers: { authorization: auth } })

describe('isCronAuthorized', () => {
  it('accepts exactly "Bearer <secret>"', () => {
    expect(isCronAuthorized(req('Bearer s3cret'), 's3cret')).toBe(true)
  })

  it.each([
    ['no header', undefined],
    ['an empty header', ''],
    ['the bare secret', 's3cret'],
    ['a wrong secret', 'Bearer s3creT'],
    ['a prefix of the secret', 'Bearer s3cre'],
    ['the secret plus more', 'Bearer s3cretX'],
    ['another scheme', 'Basic s3cret'],
    ['lower-case scheme', 'bearer s3cret'],
  ])('refuses %s', (_what, header) => {
    expect(isCronAuthorized(req(header), 's3cret')).toBe(false)
  })

  it('fails closed with no secret configured — even for "Bearer " and "Bearer undefined"', () => {
    for (const secret of [undefined, '']) {
      expect(isCronAuthorized(req('Bearer '), secret)).toBe(false)
      expect(isCronAuthorized(req('Bearer undefined'), secret)).toBe(false)
      expect(isCronAuthorized(req(), secret)).toBe(false)
    }
  })

  it('reads CRON_SECRET when no secret is passed', () => {
    const before = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'from-env'
    try {
      expect(isCronAuthorized(req('Bearer from-env'))).toBe(true)
      expect(isCronAuthorized(req('Bearer other'))).toBe(false)
    } finally {
      if (before === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = before
    }
  })
})

describe('every cron route uses the shared check (census)', () => {
  const CRON_DIR = path.join(process.cwd(), 'src/app/api/cron')
  const routes = readdirSync(CRON_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(CRON_DIR, d.name, 'route.ts'))

  it('finds the ten cron routes (non-vacuous)', () => {
    expect(routes).toHaveLength(10)
  })

  it.each(routes.map((r) => [path.basename(path.dirname(r)), r]))('%s calls isCronAuthorized and compares no bearer itself', (_name, file) => {
    const src = readFileSync(file, 'utf8')
    expect(src).toMatch(/import \{ isCronAuthorized \} from '@\/lib\/auth\/cron-secret'/)
    expect(src).toMatch(/if \(!isCronAuthorized\(request\)\)/)
    expect(src).not.toMatch(/[!=]==\s*`Bearer/)
    expect(src).not.toMatch(/process\.env\.CRON_SECRET/)
  })
})
