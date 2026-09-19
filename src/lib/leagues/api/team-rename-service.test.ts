/**
 * Unit pins for the MANAGER's own rename — M6A L.E1.13
 * (`team-rename-service.ts`; `rename_own_team`, migration 128 §4). The REAL
 * verb is driven in `commish-part2-api-db.test.ts` §5; these cells pin what
 * a database cannot: the argument shape, the order of the league check and
 * the write, the SQLSTATE mapping, and that a failed READ is never rendered
 * as "team not found".
 */
import { describe, expect, it, vi } from 'vitest'

import {
  RENAME_OWN_TEAM_FORBIDDEN_MESSAGE,
  RENAME_OWN_TEAM_NOT_IN_LEAGUE_MESSAGE,
  RENAME_OWN_TEAM_UNCONFIRMED_MESSAGE,
  renameOwnTeam,
  renameOwnTeamInputSchema,
} from './team-rename-service'

const LEAGUE = 'b4000000-0000-4000-8000-000000000001'
const OTHER_LEAGUE = 'b4000000-0000-4000-8000-000000000002'
const TEAM = 'ce000000-0000-4000-8000-000000000001'

const document = {
  verb: 'rename_own_team',
  team_id: TEAM,
  league_id: LEAGUE,
  name: 'Alpha Reborn',
  previous_name: 'Team 1',
  requested_name: 'Alpha Reborn',
  no_changes: false,
  audited: false,
  system_post: null,
}

function double(args: {
  team?: { data: { league_id: string | null } | null; error: { message: string } | null }
  rpc?: { data: unknown; error: unknown }
}) {
  const maybeSingle = vi.fn().mockResolvedValue(args.team ?? { data: { league_id: LEAGUE }, error: null })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  const rpc = vi.fn().mockResolvedValue(args.rpc ?? { data: document, error: null })
  return { client: { from, rpc } as never, from, eq, rpc }
}

describe('renameOwnTeamInputSchema — 128’s own bound (trimmed, non-empty, ≤ 100)', () => {
  it('TRIMS the name; a blank, a 101-char name, a non-string and any extra key (a smuggled reason or action_id) are refused', () => {
    expect(renameOwnTeamInputSchema.parse({ name: '  Alpha Reborn \t' }).name).toBe('Alpha Reborn')
    expect(renameOwnTeamInputSchema.safeParse({ name: ' \t ' }).success).toBe(false)
    expect(renameOwnTeamInputSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false)
    expect(renameOwnTeamInputSchema.safeParse({ name: 'x'.repeat(100) }).success).toBe(true)
    expect(renameOwnTeamInputSchema.safeParse({ name: 7 }).success).toBe(false)
    expect(renameOwnTeamInputSchema.safeParse({ name: 'A', reason: 'because' }).success).toBe(false)
    expect(renameOwnTeamInputSchema.safeParse({ name: 'A', action_id: TEAM }).success).toBe(false)
    expect(renameOwnTeamInputSchema.safeParse(null).success).toBe(false)
  })
})

describe('renameOwnTeam — the league check, the RPC call, the mapper', () => {
  it('calls rename_own_team with EXACTLY (p_team_id, p_name) — the trimmed name; no reason, no action_id, and never the commissioner’s verb', async () => {
    const { client, rpc, from, eq } = double({})
    const res = await renameOwnTeam(client, LEAGUE, TEAM, { name: '  Alpha Reborn ' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual(document)
    expect(from).toHaveBeenCalledWith('teams')
    expect(eq).toHaveBeenCalledWith('id', TEAM)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('rename_own_team', { p_team_id: TEAM, p_name: 'Alpha Reborn' })
  })

  it('a field error is a 400 BEFORE any read or write', async () => {
    const { client, rpc, from } = double({})
    expect((await renameOwnTeam(client, LEAGUE, TEAM, { name: '' })).status).toBe(400)
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('THE URL’S LEAGUE IS CHECKED BEFORE THE WRITE: a team of another league, a standalone team (league_id NULL) and an unreadable team are each the 404 — and the RPC is NEVER called', async () => {
    for (const team of [{ league_id: OTHER_LEAGUE }, { league_id: null }, null]) {
      const { client, rpc } = double({ team: { data: team, error: null } })
      const res = await renameOwnTeam(client, LEAGUE, TEAM, { name: 'Alpha Reborn' })
      expect(res.status, JSON.stringify(team)).toBe(404)
      expect(res.body).toEqual({ error: RENAME_OWN_TEAM_NOT_IN_LEAGUE_MESSAGE })
      expect(rpc).not.toHaveBeenCalled()
    }
  })

  it('a FAILED team read is a 500 with the driver’s message — never "team not found", and never a write', async () => {
    const { client, rpc } = double({ team: { data: null, error: { message: 'connection reset' } } })
    const res = await renameOwnTeam(client, LEAGUE, TEAM, { name: 'Alpha Reborn' })
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'connection reset' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps 42501 → the route’s no-leak 403, P0001 (a RETIRED franchise’s frozen name) → 409 VERBATIM, 22023 → 400, anything else → 500', async () => {
    const forbidden = await renameOwnTeam(double({ rpc: { data: null, error: { code: '42501', message: 'rename_own_team: not the manager of this team' } } }).client, LEAGUE, TEAM, { name: 'A' })
    expect(forbidden).toEqual({ status: 403, body: { error: RENAME_OWN_TEAM_FORBIDDEN_MESSAGE } })
    const retired = 'rename_own_team: franchise x is RETIRED — its name is FROZEN'
    expect(await renameOwnTeam(double({ rpc: { data: null, error: { code: 'P0001', message: retired } } }).client, LEAGUE, TEAM, { name: 'A' })).toEqual({ status: 409, body: { error: retired } })
    expect((await renameOwnTeam(double({ rpc: { data: null, error: { code: '22023', message: 'too long' } } }).client, LEAGUE, TEAM, { name: 'A' })).status).toBe(400)
    expect((await renameOwnTeam(double({ rpc: { data: null, error: { code: 'XX000', message: 'boom' } } }).client, LEAGUE, TEAM, { name: 'A' })).status).toBe(500)
  })

  it('NOTHING CAME BACK IS NOT SUCCESS: a null document, another verb’s document, another team’s or another name’s is a 500 by name — never a 200', async () => {
    for (const data of [null, { ...document, verb: 'commish_rename_team' }, { ...document, team_id: OTHER_LEAGUE }, { ...document, requested_name: 'Something Else' }]) {
      const res = await renameOwnTeam(double({ rpc: { data, error: null } }).client, LEAGUE, TEAM, { name: 'Alpha Reborn' })
      expect(res.status, JSON.stringify(data)).toBe(500)
      expect(res.body).toEqual({ error: RENAME_OWN_TEAM_UNCONFIRMED_MESSAGE })
    }
  })

  it('a NO-OP document is returned whole as a 200 — the UI reads no_changes; this layer does not turn it into an error', async () => {
    const noop = { ...document, no_changes: true, no_changes_why: 'name_already_set — …', name: 'Alpha Reborn', previous_name: 'Alpha Reborn' }
    const res = await renameOwnTeam(double({ rpc: { data: noop, error: null } }).client, LEAGUE, TEAM, { name: 'Alpha Reborn' })
    expect(res).toEqual({ status: 200, body: noop })
  })
})
