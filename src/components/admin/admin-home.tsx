'use client'

import Link from 'next/link'
import { useState } from 'react'

import { useAdminPlatformState } from '@/hooks/use-admin-platform-state'

import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminSection,
  AdminHeader,
  ConfirmActionDialog,
  GameRow,
  JobKnobs,
  when,
  type ConfirmSpec,
} from './admin-parts'
import { heldWeeks, markedGames, overdueWeeks, overdueWords, stalledJobs, stalledWhy, type OpPlatformState } from './admin-console-ops'

/**
 * `/app/admin` — what needs the operator's attention, from `op_platform_state`
 * (186; 194 adds weeks stuck past Wednesday, F600): weeks a game is holding open, paused jobs, stalled jobs and marked
 * games; then the every-league job knobs and the scheduler's last runs.
 */
export function AdminHome() {
  const q = useAdminPlatformState()
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null)

  return (
    <div className="flex flex-col gap-5" data-admin-page="home">
      <AdminHeader title="Admin" />
      {q.isLoading && <AdminLoading rows={4} label="platform" />}
      {q.error && <AdminError error={q.error} onRetry={() => q.refetch()} what="the platform view" />}
      {q.data && <AdminHomeBody state={q.data} onConfirm={setConfirm} />}
      <ConfirmActionDialog spec={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}

/** Presentational — exported for the render tests. */
export function AdminHomeBody({ state, onConfirm }: { state: OpPlatformState; onConfirm: (s: ConfirmSpec) => void }) {
  const overdue = overdueWeeks(state)
  const held = heldWeeks(state)
  const marked = markedGames(state)
  const stalled = stalledJobs(state.cron)
  const calm = overdue.length === 0 && held.length === 0 && state.pauses.length === 0 && stalled.length === 0 && marked.length === 0

  return (
    <>
      <AdminSection
        title="Needs attention"
        hint={<>As of {when(state.as_of)} · refreshes every minute</>}
        data-admin-section="attention"
      >
        {calm && <AdminEmpty label="attention">Nothing needs you. Every job ran, nothing is paused and no game is holding a week.</AdminEmpty>}

        {overdue.length > 0 && (
          <div role="alert" className="flex flex-col gap-1 border border-caution-strong bg-caution-soft px-3 py-2" data-attention="overdue-weeks">
            <h3 className="text-[12px] font-bold text-caution-strong">Weeks stuck past Wednesday</h3>
            {overdue.map((w) => (
              <p key={`${w.season}-${w.week}`} className="text-[11px] font-medium text-ink" data-overdue-week={`${w.season}-${w.week}`}>
                {overdueWords(w, when(w.ceiling_at))}
              </p>
            ))}
          </div>
        )}

        {held.length > 0 && (
          <div className="flex flex-col gap-1" data-attention="held-weeks">
            <h3 className="text-[12px] font-bold text-ink">Weeks waiting on a game</h3>
            {held.map((w) => (
              <p key={`${w.season}-${w.week}`} className="text-[11px] font-medium text-n-3" data-held-week={`${w.season}-${w.week}`}>
                {w.season} week <span className="fs-num">{w.week}</span> is waiting on {w.games.length}{' '}
                {w.games.length === 1 ? 'game' : 'games'}: {w.games.map((g) => g.matchup).join(', ')}.
              </p>
            ))}
          </div>
        )}

        {state.pauses.length > 0 && (
          <div className="flex flex-col gap-1" data-attention="pauses">
            <h3 className="text-[12px] font-bold text-ink">Paused jobs</h3>
            {state.pauses.map((p) => (
              <p key={p.id} className="text-[11px] font-medium text-n-3" data-pause={p.id}>
                {p.league_id ? (
                  <Link href={`/app/admin/leagues/${p.league_id}`} className="font-semibold text-accent hover:underline">
                    {p.league_name ?? 'A league'}
                  </Link>
                ) : (
                  <span className="font-semibold text-ink">Every league</span>
                )}
                {': '}
                {p.summary} · since {when(p.paused_at)}
              </p>
            ))}
          </div>
        )}

        {stalled.length > 0 && (
          <div className="flex flex-col gap-1" data-attention="stalled">
            <h3 className="text-[12px] font-bold text-ink">Stalled jobs</h3>
            {stalled.map((c) => (
              <p key={c.job} title={stalledWhy(c)} className="line-clamp-2 break-words text-[11px] font-medium text-n-3" data-stalled={c.job}>
                <span className="font-semibold text-ink">{c.job}</span>: {stalledWhy(c)} · {when(c.last_started_at)}
              </p>
            ))}
          </div>
        )}

        <p className="text-[10px] font-medium text-n-6" data-pending>
          Waiting: <span className="fs-num">{state.pending.waiver_claims}</span> waiver claims ·{' '}
          <span className="fs-num">{state.pending.players_waiting_to_be_rescored}</span> players to re-score.
        </p>
      </AdminSection>

      <AdminSection
        title="Games"
        hint="Games holding a week, and every game FieldScout has marked. Marking a game is the only way to let a held week close."
        data-admin-section="games"
      >
        {state.games.length === 0 ? (
          <AdminEmpty label="games">No game is holding a week and none is marked.</AdminEmpty>
        ) : (
          <ol className="flex flex-col divide-y divide-n-4">
            {state.games.map((g) => (
              <GameRow key={`${g.season}-${g.week}-${g.game_id}`} game={g} onConfirm={onConfirm} />
            ))}
          </ol>
        )}
        {state.games_total > state.games.length && (
          <p className="text-[10px] font-semibold text-caution-strong" data-overflow="games">
            Showing the first {state.games.length} of {state.games_total} games.
          </p>
        )}
      </AdminSection>

      <AdminSection
        title="Jobs for every league"
        hint="Pausing here stops the job in every league. To act on one league, open it from Leagues."
        data-admin-section="jobs-all"
      >
        <JobKnobs pauses={state.pauses} leagueId={null} onConfirm={onConfirm} />
      </AdminSection>

      <AdminSection title="Scheduler" hint="The last run of every scheduled job." data-admin-section="cron">
        {state.cron.length === 0 ? (
          <AdminEmpty label="cron">No scheduled jobs are set up on this database.</AdminEmpty>
        ) : (
          <ol className="flex flex-col divide-y divide-n-4">
            {state.cron.map((c) => (
              <li key={c.job} className="flex flex-wrap items-baseline gap-x-3 py-1.5" data-cron={c.job}>
                <span className="min-w-0 flex-1 break-words text-[11px] font-semibold text-ink">{c.job}</span>
                <span className={c.last_status === 'failed' ? 'text-[10px] font-bold text-negative-strong' : 'text-[10px] font-medium text-n-6'}>
                  {c.summary} · {when(c.last_started_at)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </AdminSection>
    </>
  )
}
