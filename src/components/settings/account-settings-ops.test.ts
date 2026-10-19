/**
 * Account settings rules shared by desktop and the phone (gap list §4 item
 * 101): the password pair (desktop's check on press, the phone's live gate —
 * prevent, don't refuse), the notification switches' opening positions and
 * the Pro plan's status line.
 */
import { describe, expect, it } from 'vitest'

import {
  NOTIFICATION_ROWS,
  PASSWORDS_DIFFER,
  PASSWORD_TOO_SHORT,
  PRO_PLAN_COPY,
  defaultNotificationPrefs,
  passwordGate,
  passwordProblem,
  proStatusLine,
} from './account-settings-ops'

describe('passwordProblem — desktop’s check when Update password is pressed', () => {
  it('names a mismatch first, then a short password, else nothing', () => {
    expect(passwordProblem('abcdefgh', 'abcdefgx')).toBe(PASSWORDS_DIFFER)
    expect(passwordProblem('abc', 'abd')).toBe(PASSWORDS_DIFFER)
    expect(passwordProblem('abc', 'abc')).toBe(PASSWORD_TOO_SHORT)
    expect(passwordProblem('abcdefgh', 'abcdefgh')).toBeNull()
  })
  it('keeps desktop’s exact words', () => {
    expect(PASSWORDS_DIFFER).toBe('Passwords do not match')
    expect(PASSWORD_TOO_SHORT).toBe('Password must be at least 8 characters')
  })
})

describe('passwordGate — the phone’s Update password, live as you type', () => {
  it('is off and quiet with nothing typed', () => {
    expect(passwordGate('', '')).toEqual({ ok: false, why: null })
  })
  it('says the length rule while the new password is short', () => {
    expect(passwordGate('a', '')).toEqual({ ok: false, why: PASSWORD_TOO_SHORT })
    expect(passwordGate('abcdefg', 'abcdefg')).toEqual({ ok: false, why: PASSWORD_TOO_SHORT })
    // Only the confirm box typed in: still the length rule, never a mismatch.
    expect(passwordGate('', 'abcdefgh')).toEqual({ ok: false, why: PASSWORD_TOO_SHORT })
  })
  it('waits quietly for the second box, then says a mismatch', () => {
    expect(passwordGate('abcdefgh', '')).toEqual({ ok: false, why: null })
    expect(passwordGate('abcdefgh', 'abc')).toEqual({ ok: false, why: PASSWORDS_DIFFER })
  })
  it('turns on for a matching pair of 8 or more', () => {
    expect(passwordGate('abcdefgh', 'abcdefgh')).toEqual({ ok: true })
    // Every pair the gate lets through also passes desktop's check.
    expect(passwordProblem('abcdefgh', 'abcdefgh')).toBeNull()
  })
})

describe('notification switches', () => {
  it('open at each row’s default — all on but Scout AI insights', () => {
    const prefs = defaultNotificationPrefs()
    expect(Object.keys(prefs)).toEqual(NOTIFICATION_ROWS.map((r) => r.key))
    expect(Object.entries(prefs).filter(([, on]) => !on).map(([k]) => k)).toEqual(['ai'])
  })
})

describe('proStatusLine', () => {
  it('shows Stripe’s status when there is one, else that everything is unlocked', () => {
    expect(proStatusLine('active')).toBe('Subscription status: active')
    expect(proStatusLine(null)).toBe(PRO_PLAN_COPY.proUnlocked)
    expect(proStatusLine('')).toBe(PRO_PLAN_COPY.proUnlocked)
  })
})
