/**
 * client-fetch.test.ts — F116 (MP.11): the ONE shared transform between a
 * `RAISE EXCEPTION` string on the wire and the copy a user reads.
 *
 * The defect: refusals rendered as
 * `create_mock_draft: you already have 3 active mock drafts — finish or
 * delete one first (§22.5)` in BOTH launchers' toasts/inline refusals —
 * the message body is deliberate product copy (§16.5.2, surfaced verbatim),
 * but the `<function_name>: ` prefix and the `(§x.y)` citation are RAISE
 * context that reached launch-facing users. Fix shape per the F116 row: one
 * transform at the surfacing layer (`sendLeagueAction` → `LeagueActionError`)
 * that every launcher already throws through — never per call site. Route
 * bodies keep the raw string, so no stack-backed assertion moves.
 *
 * Golden values are stored literals (§4.3). Pure — no stack required.
 */
import { describe, expect, it } from 'vitest'

import { userFacingMessage } from './client-fetch'

describe('userFacingMessage (F116 — the RAISE context never reaches a user)', () => {
  it('strips the raiser prefix and the spec-citation tail from the observed defect string', () => {
    expect(
      userFacingMessage(
        'create_mock_draft: you already have 3 active mock drafts — finish or delete one first (§22.5)',
      ),
    ).toBe('you already have 3 active mock drafts — finish or delete one first')
  })

  it('strips a prefix alone, and a tail alone', () => {
    expect(userFacingMessage('draft_place_bid: your bid must beat the standing high bid')).toBe(
      'your bid must beat the standing high bid',
    )
    expect(userFacingMessage('every seat must exist (§8.8)')).toBe('every seat must exist')
    // Multi-segment section numbers are the common shape (§7.3.8, §8.6.9).
    expect(userFacingMessage('practice with 8, 10, 12, 14 or 16 seats (§7.3.8)')).toBe(
      'practice with 8, 10, 12, 14 or 16 seats',
    )
  })

  it('leaves plain product copy untouched — the transform removes context, never copy', () => {
    expect(userFacingMessage('Something went wrong. Please try again.')).toBe(
      'Something went wrong. Please try again.',
    )
    // A sentence that merely CONTAINS a colon or a mid-string citation does
    // not match the anchored patterns.
    expect(userFacingMessage('Heads up: the draft is paused')).toBe('Heads up: the draft is paused')
    expect(userFacingMessage('the (§22.5) cap applies to active mocks')).toBe(
      'the (§22.5) cap applies to active mocks',
    )
  })

  it('a prefix is a lowercase identifier — capitalised copy before a colon survives', () => {
    expect(userFacingMessage('Draft night: doors open at 8')).toBe('Draft night: doors open at 8')
  })
})
