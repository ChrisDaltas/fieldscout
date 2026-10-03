'use client'

import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCommishMatchupEditLock } from '@/hooks/use-commish-matchup-lock'
import { useCommishSetResult } from '@/hooks/use-commish-result'
import { useCommishEditScore } from '@/hooks/use-commish-score'
import type { CommishMatchupOverrideResult } from '@/lib/leagues/api/commish-matchup-service'
import type { MatchupRow } from '@/lib/leagues/api/matchups-service'
import { cn } from '@/lib/utils'
import { useOverrideMode } from '@/stores/commish-override-store'

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
  type OverrideLockState,
  type ScoreGate,
} from './matchup-override-ops'

/**
 * The commissioner's matchup override — M6A task L.E1.12 (spec §15.4:1692 →
 * `commish_edit_score`, §15.4:1693 → `commish_set_result`, §10.3; PROGRESS §3
 * STANDING RULE (h); D342; Q61; Q66).
 *
 * **The controls belong to OVERRIDE MODE, not to a save** (rule (h)). The
 * switch is `OverrideModeBar` — the lineup editor's own, over the SAME store
 * (`commish-override-store.ts`, keyed by league), so a commissioner who turned
 * the mode on at a team page arrives here with it on, and vice versa. It is
 * present in EVERY week state for a commissioner and never appears as the
 * answer to a refusal. While it is on, the whole block is framed in the lime
 * "look here" tokens (fill + border; never a shadow — CLAUDE.md).
 *
 * **Both scores together** (D342 — `is_overridden` is one flag on the row),
 * and a declare-a-winner arm. **A BYE row** (F366, fixed by L.E1.16) shows
 * the home score alone and no winner arm — the bye line says why. **There is NO reason input and the request
 * carries none** (Q66 / F343): since migration 131 the verbs store NULL and
 * still write the receipt and the §10.3 post.
 *
 * **Not optimistic, not retried** — the hooks' contract. What is painted
 * after a submit is the server's CANONICAL document through
 * `overrideOutcome` (the consequence arms FIRST — R971 / §4 rule 15), or the
 * verb's refusal VERBATIM. The hooks re-read the week, the standings and the
 * activity feed on success and on error; nothing here writes a cache.
 *
 * **The controls wait for the games (Q61, ruled 2026-09-27 — L.E1.18).**
 * While any starter on either team is still playing the panel offers no
 * score or winner control and shows the server's one line naming who; it
 * asks the server (`useCommishMatchupEditLock` — the SAME SQL helper the
 * verbs refuse on) and never works the rule out itself. The same holds when a
 * side has no lineup set yet (`lineup_not_set`, R1097) or a starting slot is
 * open (`no_starter_game`, Q67 / R1140): the server's line, verbatim. If that read FAILS the failure is said as an alert and still NO
 * control is offered (R1098) — nothing is offered until the server has said
 * the matchup is editable.
 *
 * The mount is gated on the viewer's commissioner role by the page; the
 * server is the authority (126's in-body 42501).
 */
export function MatchupOverrideTools({
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
  // Which door spoke last — the panel shows ONE outcome, the latest.
  const [last, setLast] = useState<'score' | 'result' | null>(null)
  // §10.4 (L.E1.33): a winner is declared only after the before → after
  // confirmation — the side waiting for his yes, or null.
  const [confirming, setConfirming] = useState<'home' | 'away' | null>(null)
  // R1377: a pending confirmation does not outlive the state it was asked
  // in — leaving override mode, or the server no longer saying the matchup
  // is editable, drops it (React's adjust-state-during-render pattern), so
  // re-entering never resurfaces a stale "yes".
  const confirmable = overrideMode && lock.kind === 'open'
  if (confirming !== null && !confirmable) setConfirming(null)
  // R1064: what he TYPED, or null while a field is untouched — an untouched
  // field follows the stored score through live-scoring ticks; typed text is
  // never overwritten (`shownScoreDraft`).
  const [homeTyped, setHomeTyped] = useState<string | null>(null)
  const [awayTyped, setAwayTyped] = useState<string | null>(null)
  const homeDraft = shownScoreDraft(homeTyped, row.home_score)
  const awayDraft = shownScoreDraft(awayTyped, row.away_score)

  const pending = score.isPending ? 'score' : result.isPending ? 'result' : null
  const spoke = last === 'score' ? score : last === 'result' ? result : null

  return (
    <div
      className={cn('flex flex-col gap-3', overrideMode && 'rounded-sm border-2 border-brand-strong bg-brand-soft p-2 sm:p-3')}
      data-matchup-override={row.id}
      data-override-mode={overrideMode ? 'on' : 'off'}
    >
      {overrideMode && (
        <MatchupOverridePanelView
          homeName={homeName}
          awayName={awayName}
          homeDraft={homeDraft}
          awayDraft={awayDraft}
          onHomeDraft={setHomeTyped}
          onAwayDraft={setAwayTyped}
          pending={pending}
          lock={lock}
          outcome={spoke?.data ?? null}
          refusal={spoke?.error?.message ?? null}
          onSaveScores={(gate) => {
            if (!gate.ok || pending) return
            result.reset()
            setLast('score')
            score.submit({ matchupId: row.id, week: row.week, homeScore: gate.home, awayScore: gate.away })
          }}
          stored={{ home_score: row.home_score, away_score: row.away_score, result: row.result }}
          confirming={confirmable ? confirming : null}
          onDeclareWinner={(side) => {
            if (pending) return
            setConfirming(side)
          }}
          onCancelWinner={() => setConfirming(null)}
          onConfirmWinner={() => {
            const side = confirming
            const winnerTeamId = side === 'home' ? row.home_team_id : side === 'away' ? row.away_team_id : null
            setConfirming(null)
            if (!winnerTeamId || pending || !confirmable) return
            score.reset()
            setLast('result')
            result.submit({ matchupId: row.id, week: row.week, winnerTeamId })
          }}
        />
      )}
    </div>
  )
}

/**
 * The panel, as a function of its props — every branch of the result
 * document is a real render in `matchup-view.render.test.ts` without a
 * browser (a static render runs no mutation).
 */
export function MatchupOverridePanelView({
  homeName,
  awayName,
  homeDraft,
  awayDraft,
  onHomeDraft,
  onAwayDraft,
  pending,
  lock = { kind: 'open' },
  outcome,
  refusal,
  onSaveScores,
  onDeclareWinner,
  stored = null,
  confirming = null,
  onConfirmWinner = () => {},
  onCancelWinner = () => {},
}: {
  homeName: string
  /** Null on a BYE row: one score field, no winner arm (F366). */
  awayName: string | null
  homeDraft: string
  awayDraft: string
  onHomeDraft: (text: string) => void
  onAwayDraft: (text: string) => void
  pending: 'score' | 'result' | null
  /** Q61 (135): whether the controls may be offered yet — from the server. */
  lock?: OverrideLockState
  outcome: Pick<
    CommishMatchupOverrideResult,
    'no_changes' | 'live_scoring_frozen' | 'live_scoring_frozen_why' | 'standings_rebuilt' | 'bypassed'
  > | null
  refusal: string | null
  /** Handed the gate it was enabled by — the numbers sent are the numbers shown. */
  onSaveScores: (gate: ScoreGate) => void
  /** Asks for the §10.4 confirmation — nothing is written until he says yes. */
  onDeclareWinner: (side: 'home' | 'away') => void
  /** The row as STORED — the confirmation's "before" (L.E1.33). */
  stored?: { home_score: number | null; away_score: number | null; result: string | null } | null
  /** The side waiting for his yes, or null. */
  confirming?: 'home' | 'away' | null
  onConfirmWinner?: () => void
  onCancelWinner?: () => void
}) {
  const id = useId()
  const gate = scoreGate({ homeDraft, awayDraft, homeName, awayName })
  const said = outcome ? overrideOutcome(outcome) : null
  const bypassed = outcome && !outcome.no_changes ? bypassedCopy(outcome.bypassed) : null
  const gateId = `${id}-gate`

  return (
    <section className="flex flex-col gap-3 rounded-sm border border-ink bg-white px-3 py-3" aria-label={OVERRIDE_PANEL_TITLE} data-override-panel>
      <h3 className="text-[12px] font-bold text-ink">{OVERRIDE_PANEL_TITLE}</h3>

      {/* Q61 (135): no controls while a starter is still playing or a side
          has no lineup set, none before the server has answered, and none
          when the read failed (R1098). The server's line, verbatim. */}
      {lock.kind === 'checking' && (
        <p role="status" className="text-[11px] font-semibold text-n-3" data-override-lock="checking">
          {LOCK_CHECKING_COPY}
        </p>
      )}
      {lock.kind === 'locked' && (
        <p role="status" className="rounded-sm border border-ink bg-caution-soft px-3 py-2 text-[12px] font-semibold text-ink" data-override-lock="locked">
          {lock.message}
        </p>
      )}
      {lock.kind === 'unknown' && (
        <p role="alert" className="text-[11px] font-semibold text-negative" data-override-lock="unknown">
          {lock.message}
        </p>
      )}
      {lock.kind === 'open' && (
        <>
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              onSaveScores(gate)
            }}
            data-override-arm="score"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <ScoreField id={`${id}-home`} label={`${homeName} score`} value={homeDraft} onChange={onHomeDraft} disabled={pending !== null} describedBy={gate.ok ? undefined : gateId} side="home" />
              {awayName !== null && (
                <ScoreField id={`${id}-away`} label={`${awayName} score`} value={awayDraft} onChange={onAwayDraft} disabled={pending !== null} describedBy={gate.ok ? undefined : gateId} side="away" />
              )}
            </div>
            {awayName !== null && <p className="text-[11px] font-medium text-n-3">{BOTH_SCORES_COPY}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="blue" size="sm" disabled={!gate.ok || pending !== null} data-save-scores>
                {pending === 'score' ? 'Saving…' : 'Save scores'}
              </Button>
              {/* WHY Save is disabled, said (rule (h)) — never a dead button. */}
              {!gate.ok && (
                <span id={gateId} className="text-[11px] font-semibold text-n-3" data-save-gate>
                  {gate.why}
                </span>
              )}
            </div>
          </form>

          {awayName === null ? (
            // A BYE (F366): no winner arm — the result arm is refused by design
            // (131:1052-1057); the score arm above is the team's points alone.
            <p role="status" className="border-t border-n-4 pt-3 text-[11px] font-medium text-n-3" data-override-bye>
              {BYE_ROW_COPY}
            </p>
          ) : (
            <div className="flex flex-col gap-2 border-t border-n-4 pt-3" data-override-arm="result">
              <p className="text-[11px] font-medium text-n-3">{DECLARE_WINNER_COPY}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="stroke" size="sm" disabled={pending !== null} onClick={() => onDeclareWinner('home')} data-declare-winner="home">
                  {`Declare ${homeName} the winner`}
                </Button>
                <Button variant="stroke" size="sm" disabled={pending !== null} onClick={() => onDeclareWinner('away')} data-declare-winner="away">
                  {`Declare ${awayName} the winner`}
                </Button>
                {pending === 'result' && (
                  <span role="status" className="self-center text-[11px] font-semibold text-n-3">
                    Saving…
                  </span>
                )}
              </div>
              {confirming && stored && (
                <WinnerConfirm
                  confirm={declareWinnerConfirm({ side: confirming, homeName, awayName, stored })}
                  onConfirm={onConfirmWinner}
                  onCancel={onCancelWinner}
                />
              )}
            </div>
          )}
        </>
      )}

      {/* The verb's refusal, VERBATIM — that text is the UX. */}
      {refusal && (
        <p role="alert" className="rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink" data-override-refusal>
          {refusal}
        </p>
      )}
      {!refusal && said && (
        <div
          role="status"
          className={cn(
            'flex flex-col gap-1 rounded-sm border px-3 py-2 text-[12px] font-semibold text-ink',
            said.tone === 'positive' && 'border-positive bg-positive-soft',
            said.tone === 'caution' && 'border-ink bg-caution-soft',
            said.tone === 'neutral' && 'border-ink bg-n-4',
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

/** §10.4's before → after, inline (the draft panel's INLINE-expand
 *  precedent — no nested dialog), asking for nothing but the yes (C82). */
function WinnerConfirm({
  confirm,
  onConfirm,
  onCancel,
}: {
  confirm: ReturnType<typeof declareWinnerConfirm>
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div role="group" aria-label={confirm.title} className="flex flex-col gap-1.5 rounded-sm border border-ink bg-caution-soft px-3 py-2" data-declare-confirm>
      <p className="text-[12px] font-bold text-ink">{confirm.title}</p>
      <p className="text-[11px] font-semibold text-ink" data-confirm-before>
        {confirm.before}
      </p>
      <p className="text-[11px] font-semibold text-ink" data-confirm-after>
        {confirm.after}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="blue" size="sm" onClick={onConfirm} data-declare-confirm-yes>
          {confirm.confirmLabel}
        </Button>
        <Button variant="stroke" size="sm" onClick={onCancel} data-declare-confirm-cancel>
          Cancel
        </Button>
      </div>
    </div>
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
      <label htmlFor={id} className="truncate text-[11px] font-bold text-ink">
        {label}
      </label>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className="fs-num"
        data-score-input={side}
      />
    </div>
  )
}
