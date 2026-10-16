'use client'

import Link from 'next/link'
import { useDeferredValue, useState } from 'react'

import { UsernameLink } from '@/components/shared/username-link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAdminLeagueSearch } from '@/hooks/use-admin-league-search'
import { useAdminLeagueState } from '@/hooks/use-admin-league-state'

import { AdminLeagueDetailSections } from './admin-league-table'

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
import { leagueIdFromInput, verbWords, type OpLeagueState } from './admin-console-ops'

export const LEAGUE_FINDER_HINT =
  'Search every league by name or commissioner, or paste a league link or id.'

/** A league finder: a search over EVERY league (187 `op_list_leagues`, F599), or a pasted link / id. */
export function LeagueFinder({ onPick }: { onPick: (league: { id: string; name: string | null }) => void }) {
  const [text, setText] = useState('')
  const q = useDeferredValue(text.trim())
  const pastedId = leagueIdFromInput(text)
  const search = useAdminLeagueSearch(q, pastedId === null)

  return (
    <div className="flex flex-col gap-2" data-league-finder>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="League name, link or id"
        aria-label="Find a league"
        maxLength={200}
      />
      <p className="text-[10px] font-medium text-n-6">{LEAGUE_FINDER_HINT}</p>
      {pastedId ? (
        <Button size="sm" variant="blue" className="self-start" onClick={() => onPick({ id: pastedId, name: null })} data-pick-pasted>
          Open this league
        </Button>
      ) : search.isLoading ? (
        <AdminLoading rows={2} label="league-search" />
      ) : search.error ? (
        <AdminError error={search.error} onRetry={() => search.refetch()} what="leagues" />
      ) : search.data && search.data.leagues.length === 0 ? (
        <AdminEmpty label="league-search">{q ? `No league or commissioner matches “${q}”.` : 'There are no leagues yet.'}</AdminEmpty>
      ) : search.data ? (
        <>
          <ol className="flex flex-col divide-y divide-n-4">
            {search.data.leagues.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => onPick({ id: l.id, name: l.name })}
                  className="flex w-full items-baseline gap-2 rounded-md px-1 py-2 text-left transition-colors duration-100 ease-linear hover:bg-surface-hover"
                  data-league-hit={l.id}
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">{l.name}</span>
                  <span className="text-[10px] font-medium text-n-6">
                    <span className="fs-num">{l.season}</span> · {l.phase}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {search.data.more && (
            <p className="text-[10px] font-semibold text-caution-strong" data-overflow="league-search">
              Showing the first {search.data.limit} of {search.data.total}. Type more of the name to narrow it.
            </p>
          )}
        </>
      ) : null}
    </div>
  )
}

/** `/app/admin/leagues/[id]` — one league's live state with its knobs. */
export function AdminLeaguePage({ leagueId }: { leagueId: string }) {
  const q = useAdminLeagueState(leagueId)
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null)
  return (
    <div className="flex flex-col gap-5" data-admin-page="league">
      <AdminHeader title={q.data?.league.name ?? 'League'} subtitle="Admin · live state" />
      {q.isLoading && <AdminLoading rows={5} label="league" />}
      {q.error && <AdminError error={q.error} onRetry={() => q.refetch()} what="this league" />}
      {q.data && <AdminLeagueBody state={q.data} onConfirm={setConfirm} />}
      <AdminLeagueDetailSections leagueId={leagueId} />
      <ConfirmActionDialog spec={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}

/** Presentational — exported for the render tests. */
export function AdminLeagueBody({ state, onConfirm }: { state: OpLeagueState; onConfirm: (s: ConfirmSpec) => void }) {
  const current = state.weeks.filter((w) => w.status !== 'upcoming' && w.status !== 'final')
  return (
    <>
      <AdminSection
        title="Now"
        hint={<>As of {when(state.as_of)} · {state.league.season} season · league {state.league.status}</>}
        data-admin-section="league-now"
        action={
          <Link href={`/app/leagues/${state.league.id}`} className="text-[11px] font-semibold text-accent hover:underline">
            Open league
          </Link>
        }
      >
        {current.length === 0 ? (
          <AdminEmpty label="weeks">No week is being played right now.</AdminEmpty>
        ) : (
          current.map((w) => (
            <p key={`${w.season}-${w.week}`} className="text-[12px] font-semibold text-ink" data-week={w.week}>
              Week <span className="fs-num">{w.week}</span>: <span className="font-medium text-n-3">{w.summary}</span>
            </p>
          ))
        )}
        <p className="text-[10px] font-medium text-n-6" data-pending>
          <span className="fs-num">{state.pending.waiver_claims}</span> waiver claims waiting · next waiver run{' '}
          {when(state.pending.next_waiver_run_at)}
        </p>
        {state.pauses.map((p) => (
          <p key={p.id} className="text-[11px] font-semibold text-caution-strong" data-pause={p.id}>
            {p.summary}
          </p>
        ))}
      </AdminSection>

      <AdminSection title="Jobs" hint="For this league only. Lineup locking can only be run now — it is never paused." data-admin-section="jobs">
        <JobKnobs pauses={state.pauses} leagueId={state.league.id} onConfirm={onConfirm} />
      </AdminSection>

      <AdminSection
        title="Games this week"
        hint="Games still holding an open week, and why. A game’s mark applies to every league playing that week."
        data-admin-section="league-games"
      >
        {state.open_weeks.length === 0 ? (
          <AdminEmpty label="league-games">No open week, so no game is holding one.</AdminEmpty>
        ) : (
          state.open_weeks.map((w) => (
            <div key={`${w.season}-${w.week}`} className="flex flex-col" data-open-week={w.week}>
              <h3 className="text-[12px] font-bold text-ink">
                Week <span className="fs-num">{w.week}</span>
                <span className="ml-1.5 text-[10px] font-medium text-n-6">
                  · <span className="fs-num">{w.players_waiting_to_be_rescored}</span> players waiting to be re-scored (every league)
                </span>
              </h3>
              {w.games.length === 0 ? (
                <AdminEmpty label="open-week-games">Every game is final. Nothing is holding this week.</AdminEmpty>
              ) : (
                <ol className="flex flex-col divide-y divide-n-4">
                  {w.games.map((g) => (
                    <GameRow key={g.game_id} game={{ ...g, season: w.season, week: w.week }} onConfirm={onConfirm} />
                  ))}
                </ol>
              )}
            </div>
          ))
        )}
      </AdminSection>

      <AdminSection
        title="Recent actions"
        hint={`The newest ${state.receipts_limit} of each.`}
        data-admin-section="receipts"
      >
        <h3 className="text-[12px] font-bold text-ink">FieldScout</h3>
        {state.operator_receipts.length === 0 ? (
          <AdminEmpty label="operator-receipts">FieldScout has not acted on this league.</AdminEmpty>
        ) : (
          <ol className="flex flex-col divide-y divide-n-4">
            {state.operator_receipts.map((r) => (
              <li key={r.id} className="py-1.5 text-[11px] font-medium text-n-3" data-receipt={r.id}>
                <span className="font-semibold text-ink">{verbWords(r.action)}</span> · {when(r.at)}
                {r.reason && <> · “{r.reason}”</>}
              </li>
            ))}
          </ol>
        )}
        <h3 className="pt-2 text-[12px] font-bold text-ink">Commissioner</h3>
        {state.commissioner_receipts.length === 0 ? (
          <AdminEmpty label="commish-receipts">No commissioner actions yet.</AdminEmpty>
        ) : (
          <ol className="flex flex-col divide-y divide-n-4">
            {state.commissioner_receipts.map((r) => (
              <li key={r.id} className="py-1.5 text-[11px] font-medium text-n-3" data-receipt={r.id}>
                <span className="font-semibold text-ink">{r.action.replace(/_/g, ' ')}</span>
                {r.actor && (
                  <>
                    {' by '}
                    <UsernameLink username={r.actor} className="font-semibold" />
                  </>
                )}{' '}
                · {when(r.at)}
                {r.reason && <> · “{r.reason}”</>}
              </li>
            ))}
          </ol>
        )}
      </AdminSection>
    </>
  )
}
