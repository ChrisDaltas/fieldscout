import { create } from 'zustand'

import { DEFAULT_COLS, type ColKey, type MPos } from '@/components/mobile/players/players-ops'

/**
 * FieldScout Mobile — Players tab UI state (spec m-players §4 "Ways in": the
 * league tab bar's Players does not reset the filters, view, columns, sort
 * — the tab reopens exactly as it was left). Client-only UI state, so it is
 * a Zustand store (CLAUDE.md); it lasts for the app session like the
 * prototype's. The league tab and the account Players tab keep their own.
 */

export type PlayersView = 'list' | 'cards' | 'sheet'
export type LeagueStatus = 'all' | 'avail' | 'fa' | 'w' | 'rost' | 'mine'
/** This week · last week · season to date · the prior season. */
export type LeaguePeriod = 'w' | 'lw' | 'season' | 'prior'
export type ResearchScoring = 'ppr' | 'half_ppr' | 'standard'
export type ResearchSeason = 'current' | 'last'

export interface LeaguePlayersUI {
  status: LeagueStatus
  per: LeaguePeriod
  pos: MPos
  /** NFL abbreviation, or 'All'. */
  team: string
  view: PlayersView
  cols: ColKey[]
  sort: ColKey
  /** The Trending section's open state (spec §3 — lasts the app session). */
  trendOpen: boolean
  /** The search field's text (gap list §4 "Players") — a name, searched
   *  server-side over the whole pool. */
  query: string
}

export interface ResearchPlayersUI {
  scoring: ResearchScoring
  season: ResearchSeason
  pos: MPos
  team: string
  view: PlayersView
  cols: ColKey[]
  sort: ColKey
  query: string
}

export const LEAGUE_DEFAULTS: LeaguePlayersUI = {
  status: 'avail',
  per: 'w',
  pos: 'All',
  team: 'All',
  view: 'list',
  cols: DEFAULT_COLS.league,
  sort: 'proj',
  trendOpen: true,
  query: '',
}

export const RESEARCH_DEFAULTS: ResearchPlayersUI = {
  scoring: 'ppr',
  season: 'current',
  pos: 'All',
  team: 'All',
  view: 'list',
  cols: DEFAULT_COLS.research,
  sort: 'proj',
  query: '',
}

interface Store {
  league: LeaguePlayersUI
  research: ResearchPlayersUI
  setLeague: (patch: Partial<LeaguePlayersUI>) => void
  setResearch: (patch: Partial<ResearchPlayersUI>) => void
}

export const useMobilePlayersUI = create<Store>((set) => ({
  league: LEAGUE_DEFAULTS,
  research: RESEARCH_DEFAULTS,
  setLeague: (patch) => set((s) => ({ league: { ...s.league, ...patch } })),
  setResearch: (patch) => set((s) => ({ research: { ...s.research, ...patch } })),
}))
