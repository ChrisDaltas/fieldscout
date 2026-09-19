'use client'

import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCommishSetResult } from '@/hooks/use-commish-result'
import { useCommishEditScore } from '@/hooks/use-commish-score'
import type { CommishMatchupOverrideResult } from '@/lib/leagues/api/commish-matchup-service'
import type { MatchupRow } from '@/lib/leagues/api/matchups-service'
import { cn } from '@/lib/utils'
import { useCommishOverrideStore, useOverrideMode } from '@/stores/commish-override-store'

import {
  BOTH_SCORES_COPY,
  BYE_ROW_COPY,
  DECLARE_WINNER_COPY,
  OVERRIDE_BAR_OFF_COPY,
  OVERRIDE_BAR_ON_COPY,
  OVERRIDE_PANEL_TITLE,
  bypassedCopy,
  overrideOutcome,
  scoreGate,
  shownScoreDraft,
  type ScoreGate,
} from './matchup-override-ops'
import { OverrideModeBar } from './override-mode-bar'

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
 * and a declare-a-winner arm. **There is NO reason input and the request
 * carries none** (Q66 / F343): since migration 131 the verbs store NULL and
 * still write the receipt and the §10.3 post.
 *
 * **Not optimistic, not retried** — the hooks' contract. What is painted
 * after a submit is the server's CANONICAL document through
 * `overrideOutcome` (the consequence arms FIRST — R971 / §4 rule 15), or the
 * verb's refusal VERBATIM. The hooks re-read the week, the standings and the
 * activity feed on success and on error; nothing here writes a cache.
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
  const enter = useCommishOverrideStore((s) => s.enter)
  const exit = useCommishOverrideStore((s) => s.exit)
  const score = useCommishEditScore(leagueId)
  const result = useCommishSetResult(leagueId)
  // Which door spoke last — the panel shows ONE outcome, the latest.
  const [last, setLast] = useState<'score' | 'result' | null>(null)
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
      <OverrideModeBar on={overrideMode} busy={pending !== null} onToggle={(next) => (next ? enter(leagueId) : exit())}>
        {overrideMode ? OVERRIDE_BAR_ON_COPY : OVERRIDE_BAR_OFF_COPY}
      </OverrideModeBar>
      {overrideMode && awayName === null && (
        // A BYE: neither arm can land through today's routes (F366) — said by
        // name rather than offered as a Save that can only be refused.
        <p role="status" className="rounded-sm border border-ink bg-white px-3 py-2 text-[12px] font-semibold text-ink" data-override-bye>
          {BYE_ROW_COPY}
        </p>
      )}
      {overrideMode && awayName !== null && (
        <MatchupOverridePanelView
          homeName={homeName}
          awayName={awayName}
          homeDraft={homeDraft}
          awayDraft={awayDraft}
          onHomeDraft={setHomeTyped}
          onAwayDraft={setAwayTyped}
          pending={pending}
          outcome={spoke?.data ?? null}
          refusal={spoke?.error?.message ?? null}
          onSaveScores={(gate) => {
            if (!gate.ok || pending) return
            result.reset()
            setLast('score')
            score.submit({ matchupId: row.id, week: row.week, homeScore: gate.home, awayScore: gate.away })
          }}
          onDeclareWinner={(side) => {
            const winnerTeamId = side === 'home' ? row.home_team_id : row.away_team_id
            if (!winnerTeamId || pending) return
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
  outcome,
  refusal,
  onSaveScores,
  onDeclareWinner,
}: {
  homeName: string
  awayName: string
  homeDraft: string
  awayDraft: string
  onHomeDraft: (text: string) => void
  onAwayDraft: (text: string) => void
  pending: 'score' | 'result' | null
  outcome: Pick<
    CommishMatchupOverrideResult,
    'no_changes' | 'live_scoring_frozen' | 'live_scoring_frozen_why' | 'standings_rebuilt' | 'bypassed'
  > | null
  refusal: string | null
  /** Handed the gate it was enabled by — the numbers sent are the numbers shown. */
  onSaveScores: (gate: ScoreGate) => void
  onDeclareWinner: (side: 'home' | 'away') => void
}) {
  const id = useId()
  const gate = scoreGate({ homeDraft, awayDraft, homeName, awayName })
  const said = outcome ? overrideOutcome(outcome) : null
  const bypassed = outcome && !outcome.no_changes ? bypassedCopy(outcome.bypassed) : null
  const gateId = `${id}-gate`

  return (
    <section className="flex flex-col gap-3 rounded-sm border border-ink bg-white px-3 py-3" aria-label={OVERRIDE_PANEL_TITLE} data-override-panel>
      <h3 className="text-[12px] font-bold text-ink">{OVERRIDE_PANEL_TITLE}</h3>

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
          <ScoreField id={`${id}-away`} label={`${awayName} score`} value={awayDraft} onChange={onAwayDraft} disabled={pending !== null} describedBy={gate.ok ? undefined : gateId} side="away" />
        </div>
        <p className="text-[11px] font-medium text-n-3">{BOTH_SCORES_COPY}</p>
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
      </div>

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
