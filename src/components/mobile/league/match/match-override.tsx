'use client'

import { useId, useState } from 'react'

import {
  BOTH_SCORES_COPY,
  BYE_ROW_COPY,
  DECLARE_WINNER_COPY,
  LOCK_CHECKING_COPY,
  OVERRIDE_PANEL_TITLE,
  bypassedCopy,
  declareWinnerConfirm,
  overrideLockState,
  overrideOutcome,
  scoreGate,
  shownScoreDraft,
} from '@/components/leagues/matchup-override-ops'
import { useCommishMatchupEditLock } from '@/hooks/use-commish-matchup-lock'
import { useCommishSetResult } from '@/hooks/use-commish-result'
import { useCommishEditScore } from '@/hooks/use-commish-score'
import type { MatchupRow } from '@/lib/leagues/api/matchups-service'
import { cn } from '@/lib/utils'
import { useOverrideMode, useReportOverrideSaving } from '@/stores/commish-override-store'

/**
 * The commissioner's matchup override on the mobile Match tab — the desktop
 * `MatchupOverrideTools` (L.E1.12) in the FieldScout Mobile language
 * (m-match gap analysis: app-only Match content is restyled, never dropped).
 *
 * The behaviour is the desktop panel's, line for line, over the SAME hooks
 * and ops: the controls appear only in override mode and only once the
 * server says the matchup is editable (`useCommishMatchupEditLock` — Q61;
 * a failed read offers no control, R1098); both scores go together (D342);
 * a bye has the score arm alone (F366); a winner is declared only after the
 * before → after confirmation (§10.4), which drops when the mode or the lock
 * changes (R1377); there is no reason field (Q66); typed text is never
 * overwritten by a live tick (R1064); the pending save locks the header's
 * Turn off (R1460); and what is painted afterwards is the server's outcome
 * sentence or its refusal, verbatim — nothing optimistic, nothing retried.
 */
export function MobileOverrideTools({
  leagueId,
  row,
  homeName,
  awayName,
}: {
  leagueId: string
  row: MatchupRow
  homeName: string
  /** Null on a bye row. */
  awayName: string | null
}) {
  const overrideMode = useOverrideMode(leagueId)
  const score = useCommishEditScore(leagueId)
  const result = useCommishSetResult(leagueId)
  const lockRead = useCommishMatchupEditLock(leagueId, row.week, row.id, overrideMode)
  const lock = overrideLockState({ data: lockRead.data, error: lockRead.error })
  const [last, setLast] = useState<'score' | 'result' | null>(null)
  const [confirming, setConfirming] = useState<'home' | 'away' | null>(null)
  const confirmable = overrideMode && lock.kind === 'open'
  if (confirming !== null && !confirmable) setConfirming(null)
  const [homeTyped, setHomeTyped] = useState<string | null>(null)
  const [awayTyped, setAwayTyped] = useState<string | null>(null)
  const homeDraft = shownScoreDraft(homeTyped, row.home_score)
  const awayDraft = shownScoreDraft(awayTyped, row.away_score)

  const pending = score.isPending ? 'score' : result.isPending ? 'result' : null
  useReportOverrideSaving(pending !== null)
  const spoke = last === 'score' ? score : last === 'result' ? result : null
  const said = spoke?.data ? overrideOutcome(spoke.data) : null
  const bypassed = spoke?.data && !spoke.data.no_changes ? bypassedCopy(spoke.data.bypassed) : null
  const refusal = spoke?.error?.message ?? null

  const id = useId()
  const gate = scoreGate({ homeDraft, awayDraft, homeName, awayName })
  const gateId = `${id}-gate`

  if (!overrideMode) return null

  const declare = (side: 'home' | 'away') => {
    if (pending) return
    setConfirming(side)
  }
  const confirmWinner = () => {
    const side = confirming
    const winnerTeamId = side === 'home' ? row.home_team_id : side === 'away' ? row.away_team_id : null
    setConfirming(null)
    if (!winnerTeamId || pending || !confirmable) return
    score.reset()
    setLast('result')
    result.submit({ matchupId: row.id, week: row.week, winnerTeamId })
  }
  const confirm =
    confirmable && confirming && awayName !== null
      ? declareWinnerConfirm({ side: confirming, homeName, awayName, stored: { home_score: row.home_score, away_score: row.away_score, result: row.result } })
      : null

  return (
    <section
      className="flex flex-col gap-3 rounded-[18px] border border-confirm bg-m-b1 p-3.5"
      aria-label={OVERRIDE_PANEL_TITLE}
      data-matchup-override={row.id}
      data-override-panel
    >
      <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-m-t1">{OVERRIDE_PANEL_TITLE}</h3>

      {lock.kind === 'checking' && (
        <p role="status" className="text-[13px] font-medium leading-[1.4] text-m-t3" data-override-lock="checking">
          {LOCK_CHECKING_COPY}
        </p>
      )}
      {lock.kind === 'locked' && (
        <p role="status" className="rounded-[12px] bg-m-go px-3 py-2.5 text-[13px] font-medium leading-[1.4] text-m-to" data-override-lock="locked">
          {lock.message}
        </p>
      )}
      {lock.kind === 'unknown' && (
        <p role="alert" className="rounded-[12px] bg-m-gr px-3 py-2.5 text-[13px] font-medium leading-[1.4] text-m-tr" data-override-lock="unknown">
          {lock.message}
        </p>
      )}

      {lock.kind === 'open' && (
        <>
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!gate.ok || pending) return
              result.reset()
              setLast('score')
              score.submit({ matchupId: row.id, week: row.week, homeScore: gate.home, awayScore: gate.away })
            }}
            data-override-arm="score"
          >
            <div className={cn('grid gap-2', awayName !== null && 'grid-cols-2')}>
              <ScoreField id={`${id}-home`} label={`${homeName} score`} value={homeDraft} onChange={setHomeTyped} disabled={pending !== null} describedBy={gate.ok ? undefined : gateId} side="home" />
              {awayName !== null && (
                <ScoreField id={`${id}-away`} label={`${awayName} score`} value={awayDraft} onChange={setAwayTyped} disabled={pending !== null} describedBy={gate.ok ? undefined : gateId} side="away" />
              )}
            </div>
            {awayName !== null && <p className="text-[11px] font-medium leading-[1.4] text-m-t3">{BOTH_SCORES_COPY}</p>}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <button
                type="submit"
                disabled={!gate.ok || pending !== null}
                className="flex h-[38px] items-center rounded-pill bg-accent px-4 text-[14px] font-semibold text-white active:bg-accent-strong disabled:bg-m-b2 disabled:text-m-t5"
                data-save-scores
              >
                {pending === 'score' ? 'Saving…' : 'Save scores'}
              </button>
              {!gate.ok && (
                <span id={gateId} className="min-w-0 flex-1 text-[11px] font-medium leading-[1.4] text-m-t3" data-save-gate>
                  {gate.why}
                </span>
              )}
            </div>
          </form>

          {awayName === null ? (
            <p role="status" className="border-t border-m-b3 pt-3 text-[13px] font-medium leading-[1.4] text-m-t3" data-override-bye>
              {BYE_ROW_COPY}
            </p>
          ) : (
            <div className="flex flex-col gap-2 border-t border-m-b3 pt-3" data-override-arm="result">
              <p className="text-[11px] font-medium leading-[1.4] text-m-t3">{DECLARE_WINNER_COPY}</p>
              {(['home', 'away'] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  disabled={pending !== null}
                  onClick={() => declare(side)}
                  aria-pressed={confirming === side}
                  className="flex h-10 w-full items-center justify-center rounded-[12px] bg-m-b0 px-3 text-[13px] font-semibold text-m-t1 active:bg-m-b2 disabled:text-m-t5"
                  data-declare-winner={side}
                >
                  <span className="truncate">{`Declare ${side === 'home' ? homeName : awayName} the winner`}</span>
                </button>
              ))}
              {pending === 'result' && (
                <span role="status" className="text-center text-[11px] font-medium text-m-t3">
                  Saving…
                </span>
              )}
              {confirm && (
                <div role="group" aria-label={confirm.title} className="flex flex-col gap-1.5 rounded-[12px] bg-m-go px-3 py-2.5" data-declare-confirm>
                  <p className="text-[13px] font-semibold text-m-t1">{confirm.title}</p>
                  <p className="text-[12px] font-medium leading-[1.4] text-m-t1" data-confirm-before>
                    {confirm.before}
                  </p>
                  <p className="text-[12px] font-medium leading-[1.4] text-m-t1" data-confirm-after>
                    {confirm.after}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1">
                    <button
                      type="button"
                      onClick={confirmWinner}
                      className="flex min-h-[38px] items-center rounded-pill bg-accent px-4 py-1.5 text-left text-[14px] font-semibold text-white active:bg-accent-strong"
                      data-declare-confirm-yes
                    >
                      {confirm.confirmLabel}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className="h-[38px] text-[14px] font-semibold text-accent" data-declare-confirm-cancel>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {refusal && (
        <p role="alert" className="rounded-[12px] bg-m-gr px-3 py-2.5 text-[13px] font-medium leading-[1.4] text-m-tr" data-override-refusal>
          {refusal}
        </p>
      )}
      {!refusal && said && (
        <div
          role="status"
          className={cn(
            'flex flex-col gap-1 rounded-[12px] px-3 py-2.5 text-[13px] font-medium leading-[1.4]',
            said.tone === 'positive' && 'bg-m-gg text-m-tg',
            said.tone === 'caution' && 'bg-m-go text-m-to',
            said.tone === 'neutral' && 'bg-m-b2 text-m-t1',
          )}
          data-override-outcome={said.branch}
        >
          <span>{said.text}</span>
          {bypassed && (
            <span className="text-[11px] font-medium" data-override-bypassed>
              {bypassed}
            </span>
          )}
        </div>
      )}
    </section>
  )
}

function ScoreField({
  id,
  label,
  value,
  onChange,
  disabled,
  describedBy,
  side,
}: {
  id: string
  label: string
  value: string
  onChange: (text: string) => void
  disabled: boolean
  describedBy: string | undefined
  side: 'home' | 'away'
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="truncate text-[11px] font-semibold text-m-t3">
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full min-w-0 rounded-[12px] bg-m-b0 px-3 text-[15px] font-semibold tabular-nums text-m-t1 outline-none focus:shadow-m-select disabled:text-m-t5"
        data-score-input={side}
      />
    </div>
  )
}
