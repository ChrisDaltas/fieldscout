/**
 * use-league-members.test.ts — the remove chooser's DELETE body. L.E1.42
 * (Chris 2026-10-01; PROGRESS D467): there are two outcomes, takeover and
 * vacate — no retire, so no `action_id`. The reason is optional and blank
 * never reaches the wire (Q66).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { removeManagerBody } from './use-league-members'

describe('removeManagerBody — the §15.1 DELETE body per outcome', () => {
  it('takeover carries the successor; vacate carries only its mode', () => {
    expect(removeManagerBody({ memberId: 'm', mode: 'takeover', successorUserId: 'u' })).toEqual({
      mode: 'takeover',
      successor_user_id: 'u',
    })
    expect(removeManagerBody({ memberId: 'm', mode: 'vacate' })).toEqual({ mode: 'vacate' })
  })

  it('a reason is sent trimmed; a blank one is dropped', () => {
    expect(removeManagerBody({ memberId: 'm', mode: 'vacate', reason: '  moving away ' })).toEqual({
      mode: 'vacate',
      reason: 'moving away',
    })
    expect(removeManagerBody({ memberId: 'm', mode: 'vacate', reason: '   ' })).toEqual({ mode: 'vacate' })
  })

  it('L.E1.42: the hook offers no retire — no action_id is minted, and the mutation never retries', () => {
    const source = readFileSync(path.join(__dirname, 'use-league-members.ts'), 'utf8')
    const hook = source.slice(source.indexOf('export function useRemoveManager'), source.indexOf('export function useLeaveLeague'))
    expect(hook).toContain('removeManagerBody(input)')
    expect(hook).not.toContain('randomUUID')
    expect(hook).toContain('retry: false')
    expect(source).toContain("export type RemoveMode = 'takeover' | 'vacate'\n")
  })
})
