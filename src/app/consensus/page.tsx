import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import { PlayerRow } from '@/components/players/player-row'
import { createServerClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Community consensus · FieldScout',
  description:
    'Cred-weighted consensus rankings from every FieldScout big board. Updates as users rank.',
}

interface ConsensusRow {
  player_id: string | null
  full_name: string | null
  position: string | null
  team: string | null
  average_rank: number | null
  weighted_rank: number | null
  ranker_count: number | null
}

interface ConsensusPlayer {
  player_id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  status: string | null
  average_rank: number | null
  weighted_rank: number | null
  ranker_count: number | null
}

/**
 * Loads the cred-weighted consensus board from the `consensus_rankings` view
 * (weighting happens in the database — nothing recomputed here), then joins
 * headshots in one pass so rows render the standard player treatment.
 */
async function loadConsensus(): Promise<ConsensusPlayer[]> {
  const supabase = await createServerClient()

  const { data } = await supabase
    .from('consensus_rankings')
    .select(
      'player_id, full_name, position, team, average_rank, weighted_rank, ranker_count',
    )
    .order('weighted_rank', { ascending: true })
    .limit(100)

  const rows = ((data ?? []) as ConsensusRow[]).filter(
    (r): r is ConsensusRow & { player_id: string; full_name: string } =>
      Boolean(r.player_id && r.full_name),
  )
  if (rows.length === 0) return []

  const { data: players } = await supabase
    .from('players')
    .select('id, headshot_url, status')
    .in(
      'id',
      rows.map((r) => r.player_id),
    )
  const byId = new Map(
    (players ?? []).map((p) => [p.id as string, p]),
  )

  return rows.map((r) => ({
    player_id: r.player_id,
    full_name: r.full_name,
    position: r.position ?? '',
    team: r.team,
    headshot_url:
      (byId.get(r.player_id)?.headshot_url as string | null) ?? null,
    status: (byId.get(r.player_id)?.status as string | null) ?? null,
    average_rank: r.average_rank,
    weighted_rank: r.weighted_rank,
    ranker_count: r.ranker_count,
  }))
}

function fmtRank(value: number | null): string {
  return typeof value === 'number' ? value.toFixed(1) : '—'
}

export default async function ConsensusPage() {
  const players = await loadConsensus()

  return (
    <GuestShell>
      <div className="mx-auto max-w-3xl space-y-[19px]">
        <header>
          <p className="fs-overline text-n-6">Community</p>
          <h1 className="mt-[3px] text-h3">Community consensus</h1>
          <p className="mt-1.5 max-w-xl text-[11px] font-medium text-n-3">
            Cred-weighted aggregate rankings from every public big board on
            FieldScout. The more accurate your rankings, the more your votes
            count.
          </p>
        </header>

        {players.length === 0 ? (
          <div className="rounded-2xl border border-n-4 bg-white px-6 py-14 text-center">
            <h2 className="text-h6">No consensus yet</h2>
            <p className="mx-auto mt-1 max-w-md text-[11px] font-medium text-n-6">
              Consensus rankings unlock once enough users have submitted their
              big boards for the season. Sign up and add yours to be part of
              the first run.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-n-4 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-n-4 px-card-pad py-3">
              <h2 className="text-h6">Season consensus</h2>
              <span className="fs-num text-[10px] font-medium text-n-6">
                Top {players.length}
              </span>
            </div>
            <ol className="space-y-px p-1.5">
              {players.map((p, i) => (
                <li key={p.player_id}>
                  <PlayerRow
                    rank={i + 1}
                    player={{
                      id: p.player_id,
                      full_name: p.full_name,
                      position: p.position,
                      team: p.team,
                      headshot_url: p.headshot_url,
                      status: p.status,
                    }}
                    density="compact"
                    stats={[
                      { label: 'Wtd rank', value: fmtRank(p.weighted_rank) },
                      { label: 'Avg rank', value: fmtRank(p.average_rank) },
                      {
                        label: 'Rankers',
                        value:
                          typeof p.ranker_count === 'number'
                            ? String(p.ranker_count)
                            : '—',
                      },
                    ]}
                  />
                </li>
              ))}
            </ol>
            <div className="border-t border-n-4 px-card-pad py-2.5">
              <p className="text-[10px] font-medium text-n-6">
                Weighted rank counts accurate scouts more; new users still
                contribute with a weight of 1.
              </p>
            </div>
          </div>
        )}
      </div>
    </GuestShell>
  )
}
