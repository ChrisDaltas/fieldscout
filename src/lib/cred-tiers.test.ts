/**
 * Everyone starts with 7 cred (Chris 2026-10-18: "everyone should start with
 * 7 because 7 is lucky"). Pins the app's one starting number, how a missing
 * cred reads, that the tier bar makes sense at the start, and that the app's
 * number is the one migration 197 wrote into the schema.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { computeCredRank, CRED_START, CRED_TIERS, credOrStart } from './cred-tiers'

const MIGRATION = 'supabase/migrations/197_cred_starts_at_7.sql'

describe('CRED_START', () => {
  it('is 7', () => {
    expect(CRED_START).toBe(7)
  })

  it('is the number migration 197 made the column default and backfilled to', () => {
    const sql = readFileSync(path.resolve(process.cwd(), MIGRATION), 'utf8')
    expect(sql).toMatch(
      new RegExp(`ALTER TABLE public\\.profiles ALTER COLUMN cred_score SET DEFAULT ${CRED_START};`),
    )
    expect(sql).toMatch(new RegExp(`SET cred_score = ${CRED_START}\\s+WHERE cred_score IS NULL OR cred_score = 0;`))
  })
})

describe('credOrStart', () => {
  it('reads a missing cred as the start, never as 0', () => {
    expect(credOrStart(null)).toBe(CRED_START)
    expect(credOrStart(undefined)).toBe(CRED_START)
  })

  it('shows a stored cred as stored — a 0 from an account 197 has not reached included', () => {
    expect(credOrStart(7)).toBe(7)
    expect(credOrStart(340)).toBe(340)
    expect(credOrStart(0)).toBe(0)
  })
})

describe('computeCredRank at the start', () => {
  it('a new account sits on the first tier, 7 of the 100 to Sophomore', () => {
    expect(computeCredRank(CRED_START)).toEqual({
      current: CRED_TIERS[0],
      next: CRED_TIERS[1],
      progressPct: 7,
      toNext: 93,
    })
  })

  it('the start sits inside the first tier, below the second', () => {
    expect(CRED_START).toBeGreaterThanOrEqual(CRED_TIERS[0].threshold)
    expect(CRED_START).toBeLessThan(CRED_TIERS[1].threshold)
  })
})
