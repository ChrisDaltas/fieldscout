import { describe, expect, it } from 'vitest'

import { findRealAnalystNames } from './blocklist'
import { PERSONA_ROSTER, personaDisclaimer } from './roster'

/**
 * Parody firewall CI check (spec-ai-expert-personas.md §4.6): real analyst
 * names must never appear in persona seed content. Runtime write paths also
 * enforce this via assertNoRealAnalystNames — this test keeps the seed data
 * itself clean.
 */

describe('parody firewall blocklist', () => {
  it('detects real analyst names', () => {
    expect(findRealAnalystNames('I love Matthew Berry rankings')).toEqual([
      'Matthew Berry',
    ])
    expect(findRealAnalystNames('per zachariason, fade early QBs')).toContain(
      'Zachariason',
    )
  })

  it('does not false-positive on NFL player surnames', () => {
    expect(findRealAnalystNames('DJ Moore and Garrett Wilson lead the WR2s')).toEqual([])
    expect(findRealAnalystNames('Elijah Moore, Skyy Moore, and Jameson Williams')).toEqual([])
  })

  it('finds no real analyst names anywhere in the persona roster', () => {
    for (const persona of PERSONA_ROSTER) {
      const content = JSON.stringify(persona)
      expect(
        findRealAnalystNames(content),
        `roster entry ${persona.username} leaks a real analyst name`,
      ).toEqual([])
    }
  })

  it('every persona display name is a parody name ending in (AI)', () => {
    for (const persona of PERSONA_ROSTER) {
      expect(persona.display_name.endsWith('(AI)')).toBe(true)
      expect(persona.username.endsWith('-ai')).toBe(true)
    }
  })

  it('disclaimer text matches the spec verbatim shape', () => {
    expect(personaDisclaimer('Bathew Merry (AI)')).toBe(
      'Bathew Merry (AI) is a fictional, AI-generated analyst persona. It is a parody and is not affiliated with or endorsed by any real person.',
    )
  })
})
