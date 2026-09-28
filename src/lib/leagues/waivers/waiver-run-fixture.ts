/**
 * Small builders for resolveWaiverRun inputs — shared by the worked-example
 * suite and the property suite (and, later, L.D2.9's parity suite, which
 * feeds the same inputs to the SQL processor). Test-support only.
 */
import type {
  WaiverRunClaim,
  WaiverRunInput,
  WaiverRunResult,
  WaiverRunSettings,
  WaiverRunTeam,
} from './resolve-waiver-run'

export function team(
  teamId: string,
  roster: string[] = [],
  faabBalance: number | null = 100,
  extra: Partial<Omit<WaiverRunTeam, 'teamId' | 'roster' | 'faabBalance'>> = {},
): WaiverRunTeam {
  return {
    teamId,
    roster,
    faabBalance,
    acquisitionsWeek: 0,
    acquisitionsSeason: 0,
    retired: false,
    ...extra,
  }
}

export function claim(
  claimId: string,
  teamId: string,
  addPlayerId: string,
  faabBid: number,
  claimOrder: number,
  dropPlayerId: string | null = null,
): WaiverRunClaim {
  return { claimId, teamId, addPlayerId, dropPlayerId, faabBid, claimOrder }
}

export interface RunSpec {
  teams: WaiverRunTeam[]
  claims: WaiverRunClaim[]
  settings?: Partial<WaiverRunSettings>
  draftOrder?: string[]
  standings?: string[] | null
  rolling?: Record<string, number> | null
  locked?: string[]
}

/** Defaults: FAAB, reverse-standings tiebreak, roster size 10, no caps, no
 *  standings yet, draft order = the active teams in the order given. */
export function input(spec: RunSpec): WaiverRunInput {
  return {
    settings: {
      waiverType: 'faab',
      faabTiebreaker: 'reverse_standings',
      rosterSize: 10,
      acquisitionsPerWeek: null,
      acquisitionsPerSeason: null,
      ...spec.settings,
    },
    teams: spec.teams,
    claims: spec.claims,
    priority: {
      draftOrder: spec.draftOrder ?? spec.teams.filter((t) => !t.retired).map((t) => t.teamId),
      standings: spec.standings ?? null,
      rolling: spec.rolling ?? null,
    },
    lockedPlayerIds: spec.locked ?? [],
  }
}

/** One line per decision: `<n> <claim> <status>[:<reason>] $<spent>[ BREAK]`. */
export function summary(result: WaiverRunResult): string[] {
  return result.outcomes.map(
    (o) =>
      `${o.decision} ${o.claimId} ${o.status}${o.reason === null ? '' : `:${o.reason}`} $${o.faabSpent}${o.deadlockBreak ? ' BREAK' : ''}`,
  )
}

export function faabAfter(result: WaiverRunResult): Record<string, number | null> {
  return Object.fromEntries(result.teams.map((t) => [t.teamId, t.faabAfter]))
}
