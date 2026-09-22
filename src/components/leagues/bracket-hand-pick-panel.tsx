'use client'

import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCommishEditBracket } from '@/hooks/use-commish-bracket'
import type { CommishEditBracketResult } from '@/lib/leagues/api/commish-bracket-service'
import type { BracketGame, BracketRound } from '@/lib/leagues/api/playoffs-service'
import { cn } from '@/lib/utils'
import { useCommishOverrideStore, useOverrideMode } from '@/stores/commish-override-store'

import {
  HAND_PICK_BAR_OFF_COPY,
  HAND_PICK_BAR_ON_COPY,
  HAND_PICK_BYE_LABEL,
  HAND_PICK_PANEL_TITLE,
  draftFromGame,
  handPickBypassedCopy,
  handPickGate,
  handPickOutcome,
  roundEntrants,
  roundWeeks,
  type HandPickDraft,
} from './bracket-hand-pick-ops'
import { OverrideModeBar } from './override-mode-bar'
import { teamName } from './playoff-bracket-ops'

/**
 * The commissioner's playoff hand-pick — M6A task L.E1.16 (spec §11.5
 * "Bracket is commissioner-editable" → `commish_edit_bracket`, migration
 * 134, §10.3; PROGRESS F360; STANDING RULE (h); Q66).
 *
 * **The controls belong to OVERRIDE MODE, not to a save** (rule (h)). The
 * switch is `OverrideModeBar` over the SAME store as the lineup editor and
 * the matchup page (`commish-override-store.ts`, keyed by league), so a
 * commissioner who turned the mode on elsewhere arrives here with it on.
 * While it is on, the block is framed in the "look here" tokens (fill +
 * border; never a shadow — CLAUDE.md), each hand-pickable game carries a
 * "Change pairing" door (`playoff-bracket.tsx` decides which — a scored game
 * gets none), and the chosen game's panel renders HERE with two selects over
 * the round's entrants (home; away or a bye) and one Save.
 *
 * **There is NO reason input and the request carries none** (Q66 / F343).
 * **Not optimistic, not retried** — the hook's contract. What is painted
 * after a submit is the server's document through `handPickOutcome` (the
 * stand-down FIRST — §4 rule 15), or the verb's refusal VERBATIM.
 *
 * The mount is gated on the viewer's commissioner role by the bracket; the
 * server is the authority (134's in-body 42501).
 */
export function BracketHandPickTools({
  leagueId,
  round,
  game,
  teamNames,
  onClose,
}: {
  leagueId: string
  /** The round the chosen game belongs to — its entrants and its weeks. */
  round: BracketRound | null
  /** The chosen game, or null when none is open. */
  game: BracketGame | null
  teamNames: ReadonlyMap<string, string>
  onClose: () => void
}) {
  const overrideMode = useOverrideMode(leagueId)
  const enter = useCommishOverrideStore((s) => s.enter)
  const exit = useCommishOverrideStore((s) => s.exit)
  const pick = useCommishEditBracket(leagueId)
  // What he chose, keyed by the game it was chosen for — a new game opens
  // with its own pairing (never the previous game's draft).
  const [draft, setDraft] = useState<{ key: string; value: HandPickDraft } | null>(null)
  const gameKey = game ? game.weeks.map((w) => w.matchup_id).join('+') : null
  const shown = game ? (draft?.key === gameKey ? draft.value : draftFromGame(game)) : null

  return (
    <div
      className={cn('flex flex-col gap-3', overrideMode && 'rounded-sm border-2 border-brand-strong bg-brand-soft p-2 sm:p-3')}
      data-bracket-hand-pick
      data-override-mode={overrideMode ? 'on' : 'off'}
    >
      <OverrideModeBar on={overrideMode} busy={pick.isPending} onToggle={(next) => (next ? enter(leagueId) : exit())}>
        {overrideMode ? HAND_PICK_BAR_ON_COPY : HAND_PICK_BAR_OFF_COPY}
      </OverrideModeBar>
      {overrideMode && round && game && shown && (
        <BracketHandPickPanelView
          round={round}
          game={game}
          draft={shown}
          teamNames={teamNames}
          pending={pick.isPending}
          outcome={pick.data ?? null}
          refusal={pick.error?.message ?? null}
          onDraft={(value) => setDraft({ key: gameKey!, value })}
          onSave={(value) => {
            if (pick.isPending) return
            pick.submit({ matchupId: game.weeks[0].matchup_id, homeTeamId: value.homeTeamId, awayTeamId: value.awayTeamId, weeks: roundWeeks(round) })
          }}
          onClose={() => {
            pick.reset()
            onClose()
          }}
        />
      )}
    </div>
  )
}

/**
 * The panel, as a function of its props — every branch a real render in
 * `playoff-bracket.render.test.ts` without a browser.
 */
export function BracketHandPickPanelView({
  round,
  game,
  draft,
  teamNames,
  pending,
  outcome,
  refusal,
  onDraft,
  onSave,
  onClose,
}: {
  round: Pick<BracketRound, 'games' | 'round'>
  game: Pick<BracketGame, 'home_team_id' | 'away_team_id' | 'home_seed' | 'away_seed'>
  draft: HandPickDraft
  teamNames: ReadonlyMap<string, string>
  pending: boolean
  outcome: Pick<CommishEditBracketResult, 'no_changes' | 'bypassed'> | null
  refusal: string | null
  onDraft: (draft: HandPickDraft) => void
  onSave: (draft: HandPickDraft) => void
  onClose: () => void
}) {
  const id = useId()
  const entrants = roundEntrants(round)
  const gate = handPickGate(draft, game, teamNames)
  const said = outcome ? handPickOutcome(outcome) : null
  const bypassed = outcome && !outcome.no_changes ? handPickBypassedCopy(outcome.bypassed) : null
  const gateId = `${id}-gate`
  const BYE = '__bye__'
  const label = (teamId: string) => {
    const seed = entrants.find((e) => e.team_id === teamId)?.seed
    return `${seed ?? '—'} · ${teamName(teamNames, teamId)}`
  }

  return (
    <section className="flex flex-col gap-3 rounded-sm border border-ink bg-white px-3 py-3" aria-label={HAND_PICK_PANEL_TITLE} data-hand-pick-panel={game.home_team_id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[12px] font-bold text-ink">
          {HAND_PICK_PANEL_TITLE} · <span className="fs-num">{game.home_seed}</span> {teamName(teamNames, game.home_team_id)} vs{' '}
          {game.away_team_id ? (
            <>
              <span className="fs-num">{game.away_seed}</span> {teamName(teamNames, game.away_team_id)}
            </>
          ) : (
            HAND_PICK_BYE_LABEL
          )}
        </h3>
        <Button variant="stroke" size="sm" onClick={onClose} disabled={pending} data-hand-pick-close>
          Close
        </Button>
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (gate.ok) onSave(draft)
        }}
        data-hand-pick-form
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1 text-[11px] font-bold text-ink" htmlFor={`${id}-home`}>
            Home
            <Select value={draft.homeTeamId} onValueChange={(v) => onDraft({ ...draft, homeTeamId: v })} disabled={pending}>
              <SelectTrigger id={`${id}-home`} className="h-btn-md px-2 text-[12px]" data-hand-pick-side="home" aria-describedby={gate.ok ? undefined : gateId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entrants.map((e) => (
                  <SelectItem key={e.team_id} value={e.team_id}>
                    {label(e.team_id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[11px] font-bold text-ink" htmlFor={`${id}-away`}>
            Away
            <Select value={draft.awayTeamId ?? BYE} onValueChange={(v) => onDraft({ ...draft, awayTeamId: v === BYE ? null : v })} disabled={pending}>
              <SelectTrigger id={`${id}-away`} className="h-btn-md px-2 text-[12px]" data-hand-pick-side="away" aria-describedby={gate.ok ? undefined : gateId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BYE}>{HAND_PICK_BYE_LABEL}</SelectItem>
                {entrants.map((e) => (
                  <SelectItem key={e.team_id} value={e.team_id}>
                    {label(e.team_id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="blue" size="sm" disabled={!gate.ok || pending} data-hand-pick-save>
            {pending ? 'Saving…' : 'Save pairing'}
          </Button>
          {!gate.ok && (
            <span id={gateId} className="text-[11px] font-semibold text-n-3" data-hand-pick-gate>
              {gate.why}
            </span>
          )}
        </div>
      </form>

      {/* The verb's refusal, VERBATIM — that text is the UX. */}
      {refusal && (
        <p role="alert" className="rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink" data-hand-pick-refusal>
          {refusal}
        </p>
      )}
      {!refusal && said && (
        <div
          role="status"
          className={cn(
            'flex flex-col gap-1 rounded-sm border px-3 py-2 text-[12px] font-semibold text-ink',
            said.tone === 'positive' && 'border-positive bg-positive-soft',
            said.tone === 'neutral' && 'border-ink bg-n-4',
          )}
          data-hand-pick-outcome={said.branch}
        >
          <span>{said.text}</span>
          {bypassed && (
            <span className="text-[11px] font-medium" data-hand-pick-bypassed>
              {bypassed}
            </span>
          )}
        </div>
      )}
    </section>
  )
}
