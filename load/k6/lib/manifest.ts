/**
 * What the seeder (`scripts/load/seed-staging.ts`) hands the runners (M7
 * L.F2.1). Written to `load/.out/<scenario>.manifest.json` — GITIGNORED: it
 * carries the bots' per-run test passwords and the target's row ids, and the
 * repo is public (standing rule (c)). Never committed, never pasted.
 */
import type { ProfileName, TargetKind } from '../config'

export type SeedScenario = 'snake' | 'auction' | 'leagues'

export interface LoadBot {
  index: number
  email: string
  password: string
  userId: string
  username: string
}

export interface DraftSeat {
  bot: number
  teamId: string
}

export interface DraftSeed {
  leagueId: string
  draftId: string
  /** Bot index of the commissioner (starts the draft in setup). */
  commissioner: number
  seats: DraftSeat[]
}

export interface LeagueSeed {
  leagueId: string
  /** Bot indexes seated in this league (viewers are drawn from these). */
  members: number[]
}

export interface LoadManifest {
  version: 1
  scenario: SeedScenario
  profile: ProfileName
  target: TargetKind
  /** The run tag every seeded name carries (cleanup sweeps the prefix). */
  runTag: string
  createdAt: string
  bots: LoadBot[]
  drafts: DraftSeed[]
  leagues: LeagueSeed[]
  /** Draftable player ids, best ADP first (the bots' board). */
  pool: string[]
}

export function parseManifest(raw: string): LoadManifest {
  const m = JSON.parse(raw) as Partial<LoadManifest>
  if (m.version !== 1) throw new Error('load manifest: unknown version (re-run the seeder)')
  if (!m.scenario || !m.profile || !m.target || !Array.isArray(m.bots)) {
    throw new Error('load manifest: missing scenario / profile / target / bots')
  }
  return {
    version: 1,
    scenario: m.scenario,
    profile: m.profile,
    target: m.target,
    runTag: m.runTag ?? '',
    createdAt: m.createdAt ?? '',
    bots: m.bots,
    drafts: m.drafts ?? [],
    leagues: m.leagues ?? [],
    pool: m.pool ?? [],
  }
}
