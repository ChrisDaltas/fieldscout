/**
 * held-games-db.test.ts — F589 (migration 194) on the stack: `readHeldGames`
 * reads the stored team of each NULL-game line through the real PostgREST
 * (`select('*')`, `game_id IS NULL`, paged), and the filter then zeroes the
 * players whose LINE was played for the held team — traded out and released
 * included — and keeps the one traded in after playing elsewhere. Also the
 * ingest's column probe (`statTeamColumn`) against the real schema.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { statTeamColumn } from '@/lib/sync/ingest-week'
import type { Database } from '@/types/database'

import { readHeldGames, withoutHeldLines } from './held-games'

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

// A season / week no fixture or dev league uses.
const SEASON = 2096
const WEEK = 3
const P = ['vt-hg-trd', 'vt-hg-rel', 'vt-hg-new', 'vt-hg-leg', 'vt-hg-oth'] as const
const current: Record<string, string | null> = {
  'vt-hg-trd': 'MIA', // played for KC, then traded to MIA
  'vt-hg-rel': null, // played for KC, then released
  'vt-hg-new': 'KC', // played for MIA, then traded to KC
  'vt-hg-leg': 'KC', // no stored team on the line (pre-194 shape)
  'vt-hg-oth': 'NYJ',
}
const lineTeam: Record<string, string | null> = {
  'vt-hg-trd': 'KC',
  'vt-hg-rel': 'KC',
  'vt-hg-new': 'MIA',
  'vt-hg-leg': null,
  'vt-hg-oth': 'NYJ',
}

let db: SupabaseClient<Database>

async function cleanup() {
  await db.from('player_stats').delete().eq('season', SEASON)
  await db.from('nfl_games').delete().eq('season', SEASON)
  await db.from('players').delete().in('id', [...P])
}

beforeAll(async () => {
  db = createClient<Database>(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  await cleanup()
  const players = await db
    .from('players')
    .insert(P.map((id) => ({ id, full_name: id, position: 'WR', team: current[id], status: 'Active' })))
    .select('id')
  if (players.error || players.data.length !== P.length) throw new Error(`players seed: ${players.error?.message}`)
  const games = await db
    .from('nfl_games')
    .insert([
      { id: 'vt-hg-kc', season: SEASON, week: WEEK, home_team: 'KC', away_team: 'BUF', kickoff_at: '2096-09-20T17:00:00Z', status: 'postponed', operator_hold: 'cancelled', operator_hold_at: '2096-09-20T18:00:00Z', operator_hold_prior_status: 'scheduled' },
      { id: 'vt-hg-mia', season: SEASON, week: WEEK, home_team: 'MIA', away_team: 'NYJ', kickoff_at: '2096-09-20T17:00:00Z', status: 'final' },
    ])
    .select('id')
  if (games.error || games.data.length !== 2) throw new Error(`games seed: ${games.error?.message}`)
  const stats = await db
    .from('player_stats')
    .insert(P.map((id) => ({ player_id: id, season: SEASON, week: WEEK, stat_type: 'weekly', receiving_yards: 50, team: lineTeam[id] })))
    .select('player_id')
  if (stats.error || stats.data.length !== P.length) throw new Error(`stats seed: ${stats.error?.message}`)
})

afterAll(async () => {
  await cleanup()
})

describe('F589 on the stack', () => {
  it('the ingest probe finds player_stats.team (194 applied)', async () => {
    expect(await statTeamColumn(db)).toBe(true)
  })

  it('readHeldGames reads each NULL-game line\'s stored team; the filter zeroes by the team the line was played for', async () => {
    const held = await readHeldGames(db, SEASON, WEEK)
    expect([...held.gameIds]).toEqual(['vt-hg-kc'])
    expect(Object.fromEntries([...held.lineTeams].filter(([id]) => id.startsWith('vt-hg-')).sort())).toEqual({
      'vt-hg-new': 'MIA',
      'vt-hg-oth': 'NYJ',
      'vt-hg-rel': 'KC',
      'vt-hg-trd': 'KC',
    })
    const lines = new Map(P.map((id) => [id, { game_id: null }]))
    expect(withoutHeldLines(lines, held, (id) => current[id]).dropped).toEqual(['vt-hg-leg', 'vt-hg-rel', 'vt-hg-trd'])
  })
})
