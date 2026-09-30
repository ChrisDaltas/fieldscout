/**
 * use-league-members.test.ts — L.E1.40 (F262(a) / F546; PROGRESS D461): the
 * remove chooser's DELETE body. A retirement carries ONE `action_id` per
 * submit (120's replay stamp — the route refuses a retire without one and one
 * on the other modes); the reason is optional and blank never reaches the
 * wire (Q66).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { removeManagerBody } from './use-league-members'

const ID = 'a0000000-0000-4000-8000-000000000001'

describe('removeManagerBody — the §15.1 DELETE body per outcome', () => {
  it('retire carries the action_id and no reason when none was typed', () => {
    expect(removeManagerBody({ memberId: 'm', mode: 'retire' }, ID)).toEqual({ mode: 'retire', action_id: ID })
    expect(removeManagerBody({ memberId: 'm', mode: 'retire', reason: '   ' }, ID)).toEqual({ mode: 'retire', action_id: ID })
  })

  it('retire with a reason sends it trimmed', () => {
    expect(removeManagerBody({ memberId: 'm', mode: 'retire', reason: '  moving away ' }, ID)).toEqual({
      mode: 'retire',
      reason: 'moving away',
      action_id: ID,
    })
  })

  it('takeover and vacate never carry an action_id (the route refuses one there)', () => {
    expect(removeManagerBody({ memberId: 'm', mode: 'takeover', successorUserId: 'u' }, ID)).toEqual({
      mode: 'takeover',
      successor_user_id: 'u',
    })
    expect(removeManagerBody({ memberId: 'm', mode: 'vacate', reason: 'x' }, ID)).toEqual({ mode: 'vacate', reason: 'x' })
  })

  it('the hook mints a fresh id per submit and never retries (an action_id is consumed by its submit)', () => {
    const source = readFileSync(path.join(__dirname, 'use-league-members.ts'), 'utf8')
    const hook = source.slice(source.indexOf('export function useRemoveManager'), source.indexOf('export function useLeaveLeague'))
    expect(hook).toContain('removeManagerBody(input, crypto.randomUUID())')
    expect(hook).toContain('retry: false')
  })
})
