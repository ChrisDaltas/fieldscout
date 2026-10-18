/**
 * The one team-name rule (Chris 2026-10-18: "team names ≤ 24 everywhere";
 * migration 196, PROGRESS D545): every schema that takes a team name holds
 * it to 24 with the same words, and the LEAGUE name keeps its own 100.
 * Pure — no stack.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { commishRenameTeamInputSchema } from './api/commish-team-service'
import { createLeagueInputSchema } from './api/leagues-service'
import { addPlaceholderSeatInputSchema } from './api/members-service'
import { renameOwnTeamInputSchema } from './api/team-rename-service'
import { TEAM_NAME_MAX, TEAM_NAME_TOO_LONG, teamNameSchema } from './team-name'

const x = (n: number) => 'x'.repeat(n)

describe('the rule', () => {
  it('is 24 characters, said plainly', () => {
    expect(TEAM_NAME_MAX).toBe(24)
    expect(TEAM_NAME_TOO_LONG).toBe('Team names can be up to 24 characters.')
  })

  it('trims, then holds the name to 1–24 — 24 lands, 25 is refused with the rule’s words', () => {
    expect(teamNameSchema.parse(`  ${x(24)}  `)).toBe(x(24))
    const long = teamNameSchema.safeParse(x(25))
    expect(long.success).toBe(false)
    expect(long.error && z.flattenError(long.error).formErrors).toEqual([TEAM_NAME_TOO_LONG])
    expect(teamNameSchema.safeParse(' \t ').success).toBe(false)
  })
})

describe('every door that takes a team name uses it', () => {
  const ACTION = 'afa00000-0000-4000-8000-000000000001'
  const TEAM = 'ce000000-0000-4000-8000-000000000001'

  it('a manager’s own rename', () => {
    expect(renameOwnTeamInputSchema.safeParse({ name: x(24) }).success).toBe(true)
    const long = renameOwnTeamInputSchema.safeParse({ name: x(25) })
    expect(long.error && z.flattenError(long.error).fieldErrors.name).toEqual([TEAM_NAME_TOO_LONG])
  })

  it('the commissioner’s rename', () => {
    const body = { team_id: TEAM, action_id: ACTION }
    expect(commishRenameTeamInputSchema.safeParse({ ...body, name: x(24) }).success).toBe(true)
    const long = commishRenameTeamInputSchema.safeParse({ ...body, name: x(25) })
    expect(long.error && z.flattenError(long.error).fieldErrors.name).toEqual([TEAM_NAME_TOO_LONG])
  })

  it('the creator’s team name when creating a league (was 60) — and it stays optional', () => {
    const teamName = createLeagueInputSchema.shape.team_name
    expect(teamName.safeParse(undefined).success).toBe(true)
    expect(teamName.safeParse(x(24)).success).toBe(true)
    expect(teamName.safeParse(x(25)).success).toBe(false)
  })

  it('a commissioner’s added seat (was 60) — and it stays optional', () => {
    expect(addPlaceholderSeatInputSchema.safeParse({}).success).toBe(true)
    expect(addPlaceholderSeatInputSchema.safeParse({ team_name: null }).success).toBe(true)
    expect(addPlaceholderSeatInputSchema.safeParse({ team_name: x(24) }).success).toBe(true)
    const long = addPlaceholderSeatInputSchema.safeParse({ team_name: x(25) })
    expect(long.error && z.flattenError(long.error).fieldErrors.team_name).toEqual([TEAM_NAME_TOO_LONG])
  })

  it('the LEAGUE name is not part of the rule — it keeps 100', () => {
    const leagueName = createLeagueInputSchema.shape.name
    expect(leagueName.safeParse(x(100)).success).toBe(true)
    expect(leagueName.safeParse(x(101)).success).toBe(false)
  })
})
