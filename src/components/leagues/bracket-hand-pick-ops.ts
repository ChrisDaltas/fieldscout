import type { CommishEditBracketResult } from '@/lib/leagues/api/commish-bracket-service'
import type { BracketGame, BracketRound } from '@/lib/leagues/api/playoffs-service'

/**
 * Pure decisions for `bracket-hand-pick-panel.tsx` — M6A task L.E1.16 (spec
 * §11.5 "Bracket is commissioner-editable" → `commish_edit_bracket`,
 * migration 134; PROGRESS F360; STANDING RULE (h): the controls belong to
 * override mode; §16.5: no explanatory copy — the panel says what a control
 * DOES, the server's refusal says why it did not).
 *
 * **THE RULES THIS FILE KEEPS.** (1) The client computes nothing about the
 * bracket: the ENTRANTS of a round are the teams 118's document seats on
 * its games (`roundEntrants`) — never the standings; the server re-validates
 * the same set and refuses a stranger by name. (2) A game the engine has
 * SCORED (a written score, a result, an override, or `final`) gets NO
 * control — 134 refuses it as a validity wall (§22.2 / rule 9) and rule (h)
 * says a control that can only be refused is not offered. A game whose week
 * has merely OPENED is offered (the timing gates are lifted and named).
 * (3) The outcome shown after a submit is the server's document, the
 * stand-down FIRST among the success arms (§4 rule 15: what the engine
 * will no longer do is the consequence). (4) No ledger code in copy.
 */

export const HAND_PICK_BAR_OFF_COPY =
  'Commissioner — override mode lets you hand-pick a playoff matchup. It stays on until you turn it off, and every change is recorded.'
export const HAND_PICK_BAR_ON_COPY =
  'Choose a game below and set who plays whom. The teams you move swap places; a bye is a slot. Every change is recorded and posted to the league. Exit when you’re done.'
export const HAND_PICK_PANEL_TITLE = 'Hand-pick this matchup'
export const HAND_PICK_BYE_LABEL = 'Bye'
export const HAND_PICK_OPEN_LABEL = 'Change pairing'
export const HAND_PICKED_BADGE = '✸ hand-picked'

/** The stand-down, said as the consequence it is (§4 rule 15). */
export const STOOD_DOWN_COPY =
  'Saved. This round is now yours: the bracket engine will not re-seed it, even if a late correction moves a seed. The next round is still built from its winners.'
export const HAND_PICK_NO_CHANGES_COPY = 'Nothing changed — that is already the pairing. No entry was recorded.'

export interface HandPickDraft {
  homeTeamId: string
  /** Null = a bye for the home side. */
  awayTeamId: string | null
}

export interface HandPickGate {
  ok: boolean
  /** WHY Save is disabled, said (rule (h)) — never a dead button. */
  why: string | null
}

/** The round's entrants, seed order — the teams 118 seats on its games,
 *  home then away, each once. A round with no built game has none. */
export function roundEntrants(round: Pick<BracketRound, 'games'>): Array<{ team_id: string; seed: number }> {
  const out: Array<{ team_id: string; seed: number }> = []
  for (const g of round.games) {
    out.push({ team_id: g.home_team_id, seed: g.home_seed })
    if (g.away_team_id !== null && g.away_seed !== null) out.push({ team_id: g.away_team_id, seed: g.away_seed })
  }
  return out.sort((a, b) => a.seed - b.seed)
}

/** A game 134 would refuse as PLAYED (§22.2 / rule 9) — mirrors the verb's
 *  kept gate so no control is offered that can only be refused: `final`, a
 *  written result, an override, or a non-zero score on any week's row. A
 *  `live` row with 118's untouched default 0 is NOT played. */
export function gameHandPickable(game: Pick<BracketGame, 'final' | 'weeks'>): boolean {
  if (game.final) return false
  return !game.weeks.some(
    (w) => w.is_overridden || w.result !== null || (w.home_score ?? 0) !== 0 || (w.away_score ?? 0) !== 0,
  )
}

/** The mark, read from 118's week entries (`hand_picked_action_id`). */
export function gameHandPicked(game: Pick<BracketGame, 'weeks'>): boolean {
  return game.weeks.some((w) => w.hand_picked_action_id != null)
}

/** The draft a game opens with — its own pairing. */
export function draftFromGame(game: Pick<BracketGame, 'home_team_id' | 'away_team_id'>): HandPickDraft {
  return { homeTeamId: game.home_team_id, awayTeamId: game.away_team_id }
}

/** Whether Save is available, and WHY not. Home and away naming one team
 *  is the verb's own 22023, caught here; an unchanged draft is a no-op the
 *  server would answer by name — offered anyway? No: rule (h) — the button
 *  says why it waits. */
export function handPickGate(draft: HandPickDraft, game: Pick<BracketGame, 'home_team_id' | 'away_team_id'>, names: ReadonlyMap<string, string>): HandPickGate {
  if (draft.awayTeamId !== null && draft.awayTeamId === draft.homeTeamId) {
    return { ok: false, why: `${names.get(draft.homeTeamId) ?? 'That team'} can’t play itself — pick a different opponent.` }
  }
  if (draft.homeTeamId === game.home_team_id && draft.awayTeamId === game.away_team_id) {
    return { ok: false, why: 'That is already the pairing.' }
  }
  return { ok: true, why: null }
}

export type HandPickOutcome = { branch: 'no_changes'; tone: 'neutral'; text: string } | { branch: 'stood_down'; tone: 'positive'; text: string }

/** The server's answer, said — the no-op by name, otherwise the stand-down
 *  (every change lands it; 134 names it in `bypassed[]` and this line is
 *  what that name means to the league). */
export function handPickOutcome(result: Pick<CommishEditBracketResult, 'no_changes'>): HandPickOutcome {
  if (result.no_changes) return { branch: 'no_changes', tone: 'neutral', text: HAND_PICK_NO_CHANGES_COPY }
  return { branch: 'stood_down', tone: 'positive', text: STOOD_DOWN_COPY }
}

/** `bypassed[]` rendered back, minus the stand-down (which `handPickOutcome`
 *  already said): the TIMING gates the override walked past, by the verb's
 *  own names. Null when none. */
export function handPickBypassedCopy(bypassed: readonly string[] | null | undefined): string | null {
  const gates = (bypassed ?? []).filter((b) => !b.startsWith('bracket_sync_rebuild:'))
  if (gates.length === 0) return null
  return `This change walked past: ${gates.join(', ')}.`
}

/** The weeks of the round, for the hook's invalidation. */
export function roundWeeks(round: Pick<BracketRound, 'weeks'>): number[] {
  return round.weeks.map((w) => w.week)
}
